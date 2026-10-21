import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Analytics } from "./analytics.ts";
import type { DashboardBundle } from "./data.ts";
import { headlineForm, signaturePhrase } from "./share.ts";

// Launch material built from the corpus: one mail-merge row per sitting
// deputy (their own figures, to tell them their page is online) and one press
// dossier per department for the regional papers.

type Seat = { dept: string; deptName: string; circo: number; current: boolean };
type Person = { id: string; name: string; party: string; acteurId?: string; seat?: Seat };
type Party = { id: string; label: string };
type PhraseRow = { ngram: string; count: number; ratio?: number | null; rest?: number };

export type Contact = { civility: string; firstName: string; lastName: string; email: string };

export type OutreachRow = {
  id: string;
  civility: string;
  salutation: string;
  firstName: string;
  lastName: string;
  fullName: string;
  feminine: boolean;
  email: string;
  party: string;
  partyLabel: string;
  dept: string;
  deptName: string;
  circo: number;
  circoLabel: string;
  speeches: number;
  words: number;
  sittings: number;
  firstDate: string;
  moreActiveThan: number | null;
  theme: string;
  themeShare: number;
  phrase: string;
  phraseCount: number;
  // Uses by every other speaker; null with an analytics database too old to say.
  phraseRest: number | null;
  // 0 when the counts are too small for a ratio to mean anything.
  phraseRatio: number;
  withGroup: number | null;
  votes: number;
  stances: number;
  excerpt: { snippet: string; date: string; debate: string; url: string } | null;
  link: string;
  segment: "actif" | "discret" | "silencieux";
  subject: string;
  hook: string;
};

const ABROAD = "099";
const MIN_COMPARABLE_VOTES = 10;
const QUIET_SPEECHES = 10;
const NUMBER = new Intl.NumberFormat("fr-FR");
const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

function fmtInt(value: number): string {
  return NUMBER.format(Math.round(value));
}

function fmtPct(share: number): string {
  return `${fmtInt(share * 100)} %`;
}

function fmtRatio(ratio: number): string {
  return ratio >= 10 ? fmtInt(ratio) : ratio.toLocaleString("fr-FR", { maximumFractionDigits: 1 });
}

export function fmtDay(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  if (!year || !month || !date) {
    return day;
  }
  return `${date === 1 ? "1er" : date} ${MONTHS[month - 1]} ${year}`;
}

function plural(count: number, singular: string, pluralForm: string): string {
  return `${fmtInt(count)} ${count > 1 ? pluralForm : singular}`;
}

function ordinal(number: number): string {
  return number === 1 ? "1re" : `${number}e`;
}

export function slugify(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function withoutCivility(name: string): string {
  return name.replace(/^(m\.|mme|mlle)\s+/i, "").trim();
}

// AMO lists every address a deputy gave (town hall, party, personal): the
// Assemblée one is the one meant for this kind of mail.
export function amoContact(amoDir: string, acteurId: string): Contact | null {
  const file = path.join(amoDir, `${acteurId}.json`);
  if (!acteurId || !existsSync(file)) {
    return null;
  }
  const actor = (JSON.parse(readFileSync(file, "utf8")) as { acteur?: Record<string, any> }).acteur || {};
  const ident = actor.etatCivil?.ident || {};
  const raw = actor.adresses?.adresse;
  const addresses = (Array.isArray(raw) ? raw : raw ? [raw] : []) as Array<Record<string, unknown>>;
  const emails = addresses.filter((item) => String(item.type) === "15" && item.valElec).map((item) => String(item.valElec).trim());
  return {
    civility: String(ident.civ || ""),
    firstName: String(ident.prenom || ""),
    // "Martin (Gironde)": AMO's way of telling namesakes apart.
    lastName: String(ident.nom || "").replace(/\s*\([^)]*\)\s*$/, ""),
    email: emails.find((email) => email.toLowerCase().endsWith("@assemblee-nationale.fr")) || emails[0] || "",
  };
}

// Every open seat of the 17th legislature, including deputies the dashboard
// has no page for (a recent substitute who has not spoken yet, the President).
export function amoSittingDeputies(amoDir: string): Array<{ acteurId: string; name: string; deptName: string; circo: number }> {
  const asList = (value: unknown) => (Array.isArray(value) ? value : value ? [value] : []) as Array<Record<string, any>>;
  const sitting = [];
  for (const file of readdirSync(amoDir).filter((name) => name.endsWith(".json"))) {
    const actor = (JSON.parse(readFileSync(path.join(amoDir, file), "utf8")) as { acteur?: Record<string, any> }).acteur || {};
    const seat = asList(actor.mandats?.mandat).find((m) => m.typeOrgane === "ASSEMBLEE" && String(m.legislature) === "17" && !m.dateFin);
    if (seat) {
      const ident = actor.etatCivil?.ident || {};
      sitting.push({
        acteurId: String(actor.uid?.["#text"] || actor.uid || ""),
        name: `${ident.prenom || ""} ${ident.nom || ""}`.trim(),
        deptName: String(seat.election?.lieu?.departement || ""),
        circo: Number(seat.election?.lieu?.numCirco || 0),
      });
    }
  }
  return sitting;
}

export function withUtm(baseURL: string, query: Record<string, string>, campaign: string, source: string): string {
  const url = new URL("/", baseURL);
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value);
  }
  url.searchParams.set("utm_source", source);
  url.searchParams.set("utm_medium", "email");
  url.searchParams.set("utm_campaign", campaign);
  return url.toString();
}

// outreachRows keeps phraseRatio only when headlineForm states the phrase by
// its ratio, so the note reads the same as the share card.
function phraseNote(row: Pick<OutreachRow, "phraseRatio" | "phraseCount" | "phraseRest">, them: "vous" | "il"): string {
  if (row.phraseRatio) {
    return them === "vous"
      ? `, ${fmtRatio(row.phraseRatio)} fois plus souvent que le reste de l'Assemblée`
      : `${fmtRatio(row.phraseRatio)} fois plus souvent que le reste de l'Assemblée`;
  }
  if (row.phraseRest === null) {
    return "";
  }
  const said = plural(row.phraseCount, "fois", "fois");
  if (them === "vous") {
    return row.phraseRest === 0
      ? ` : vous l'avez employée ${said}, aucun autre orateur ne l'a fait`
      : ` : vous l'avez employée ${said}, contre ${plural(row.phraseRest, "fois", "fois")} pour tous les autres orateurs réunis`;
  }
  return row.phraseRest === 0 ? `${said}, aucun autre orateur` : `${said}, contre ${fmtInt(row.phraseRest)} pour tous les autres orateurs réunis`;
}

function subjectFor(row: Omit<OutreachRow, "subject" | "hook">): string {
  if (row.phrase) {
    return `« ${row.phrase} » : l'expression qui vous distingue à l'Assemblée`;
  }
  if (row.speeches) {
    return `Vos ${plural(row.speeches, "intervention", "interventions")} à l'Assemblée, analysées pour vos électeurs`;
  }
  return "Vos votes à l'Assemblée, désormais lisibles par vos électeurs";
}

function hookFor(row: Omit<OutreachRow, "subject" | "hook">): string {
  const vous = row.feminine ? "Vous êtes intervenue" : "Vous êtes intervenu";
  if (row.phrase) {
    return `${vous} ${plural(row.speeches, "fois", "fois")} en séance. L'expression qui vous distingue le plus : « ${row.phrase} »${phraseNote(row, "vous")}.`;
  }
  if (row.speeches) {
    const theme = row.theme ? ` Votre premier sujet : ${row.theme}.` : "";
    return `${vous} ${plural(row.speeches, "fois", "fois")} en séance.${theme}`;
  }
  return row.votes
    ? `Vos ${plural(row.votes, "vote", "votes")} en séance publique sont désormais présentés sur une fiche à votre nom.`
    : "Une fiche à votre nom présente désormais votre activité en séance publique.";
}

export function sittingDeputies(bundle: DashboardBundle): Person[] {
  return (bundle.politicians as unknown as Person[]).filter(
    (person) => person.seat?.current && person.party !== "GOUV" && person.party !== "UNLABELED",
  );
}

export function outreachRows(
  analytics: Analytics,
  bundle: DashboardBundle,
  baseURL: string,
  contactOf: (acteurId: string) => Contact | null,
): OutreachRow[] {
  const parties = new Map((bundle.parties as Party[]).map((party) => [party.id, party.label]));
  const period = analytics.period(null, null);
  const rows: OutreachRow[] = [];
  for (const person of sittingDeputies(bundle)) {
    const seat = person.seat as Seat;
    const view = analytics.politician(person.id, period);
    const contact = contactOf(person.acteurId || "");
    const civility = contact?.civility || (/^(mme|mlle)\b/i.test(person.name) ? "Mme" : "M.");
    const feminine = /^(mme|mlle)/i.test(civility);
    const themes = (view?.themes || []).filter((theme) => analytics.themeIds.get(theme.id)?.type === "theme");
    const phrase = signaturePhrase(view?.words?.distinctive as Record<string, PhraseRow[]> | undefined);
    const votes = view?.votes;
    const speeches = view?.activity.speeches || 0;
    const base = {
      id: person.id,
      civility,
      salutation: feminine ? "Madame la Députée" : "Monsieur le Député",
      firstName: contact?.firstName || "",
      lastName: contact?.lastName || "",
      fullName: contact ? `${contact.firstName} ${contact.lastName}`.trim() : withoutCivility(person.name),
      feminine,
      email: contact?.email || "",
      party: person.party,
      partyLabel: parties.get(person.party) || person.party,
      dept: seat.dept,
      deptName: seat.dept === ABROAD ? "Français établis hors de France" : seat.deptName,
      circo: seat.circo,
      circoLabel: `${ordinal(seat.circo)} circonscription`,
      speeches,
      words: view?.activity.words || 0,
      sittings: view?.activity.sittings || 0,
      firstDate: view?.activity.firstDate || "",
      moreActiveThan: view?.activity.moreActiveThan ?? null,
      theme: themes[0] ? analytics.themeIds.get(themes[0].id)?.label || themes[0].id : "",
      themeShare: themes[0]?.share || 0,
      phrase: phrase?.ngram || "",
      phraseCount: phrase?.count || 0,
      phraseRest: phrase && phrase.rest !== undefined ? phrase.rest : null,
      phraseRatio: phrase && headlineForm(phrase) === "ratio" ? phrase.ratio || 0 : 0,
      withGroup: votes && votes.comparable >= MIN_COMPARABLE_VOTES ? votes.withGroup / votes.comparable : null,
      votes: votes?.cast || 0,
      stances: (view?.stances || []).reduce((sum, item) => sum + item.favorable + item.unfavorable + item.mixed, 0),
      excerpt: view?.excerpts?.[0]
        ? { snippet: view.excerpts[0].snippet, date: view.excerpts[0].date, debate: view.excerpts[0].debate, url: view.excerpts[0].url }
        : null,
      link: withUtm(baseURL, { depute: person.id }, "lancement-deputes", "depute"),
      segment: (speeches === 0 ? "silencieux" : speeches < QUIET_SPEECHES ? "discret" : "actif") as OutreachRow["segment"],
    };
    rows.push({ ...base, subject: subjectFor(base), hook: hookFor(base) });
  }
  return rows.sort(
    (a, b) => Number(a.dept === ABROAD) - Number(b.dept === ABROAD) || a.dept.localeCompare(b.dept) || a.circo - b.circo,
  );
}

// ------------------------------------------------------------------ CSV

function csvCell(value: string | number): string {
  const text = String(value);
  return /[;"\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

// Semicolons and a byte order mark: what Excel expects on a French system.
export function toCsv(header: string[], lines: Array<Array<string | number>>): string {
  return `\ufeff${[header, ...lines].map((line) => line.map(csvCell).join(";")).join("\r\n")}\r\n`;
}

export const DEPUTY_COLUMNS = [
  "civilite",
  "salutation",
  "prenom",
  "nom",
  "email",
  "groupe",
  "departement",
  "circonscription",
  "segment",
  "interventions",
  "mots",
  "seances",
  "plus_actif_que",
  "sujet_principal",
  "part_sujet",
  "expression",
  "expression_emplois",
  "expression_autres_orateurs",
  "expression_ratio",
  "vote_avec_groupe",
  "votes",
  "annonces_de_vote",
  "lien",
  "objet",
  "accroche",
];

export function deputyCsv(rows: OutreachRow[]): string {
  return toCsv(
    DEPUTY_COLUMNS,
    rows.map((row) => [
      row.civility,
      row.salutation,
      row.firstName,
      row.lastName,
      row.email,
      row.partyLabel,
      row.deptName,
      row.circoLabel,
      row.segment,
      row.speeches,
      row.words,
      row.sittings,
      row.moreActiveThan === null ? "" : fmtPct(row.moreActiveThan),
      row.theme,
      row.theme ? fmtPct(row.themeShare) : "",
      row.phrase,
      row.phrase ? row.phraseCount : "",
      row.phrase && row.phraseRest !== null ? row.phraseRest : "",
      row.phraseRatio ? fmtRatio(row.phraseRatio) : "",
      row.withGroup === null ? "" : fmtPct(row.withGroup),
      row.votes,
      row.stances,
      row.link,
      row.subject,
      row.hook,
    ]),
  );
}

export const DEPUTY_TEMPLATE = `Objet : {{objet}}

{{salutation}},

Polititia publie depuis peu une fiche consacrée à chaque député, construite à partir des comptes rendus officiels de la séance publique et des scrutins de l'Assemblée nationale.

{{accroche}}

Votre fiche :
{{lien}}

Vous y trouverez vos sujets de prédilection, les expressions qui vous distinguent, vos votes et vos annonces de vote, comparés à ceux de votre groupe. Tout est sourcé : chaque citation renvoie au compte rendu d'origine.

Les habitants de la {{circonscription}} ({{departement}}) peuvent désormais retrouver leur député par sa commune et suivre son activité. Si vous relevez une erreur ou souhaitez apporter un éclairage, il suffit de répondre à ce message : nous corrigeons tout ce qui est factuellement inexact.

Bien cordialement,

[Votre nom]
Polititia — la parole des députés, analysée en toute transparence

---
Ce message vous est adressé une seule fois, à votre adresse professionnelle de député. Polititia n'est lié à aucun parti.
`;

// ------------------------------------------------------------------ press

export type DepartmentDossier = { dept: string; deptName: string; slug: string; file: string; headline: string; markdown: string };

function deputyLine(row: OutreachRow): string {
  const cells = [
    row.circoLabel.replace(" circonscription", ""),
    row.fullName,
    row.partyLabel,
    fmtInt(row.speeches),
    row.theme || "—",
    row.phrase ? `« ${row.phrase} »` : "—",
    row.withGroup === null ? "—" : fmtPct(row.withGroup),
  ];
  return `| ${cells.map((cell) => cell.replaceAll("|", "/")).join(" | ")} |`;
}

function departmentAngles(rows: OutreachRow[]): { headline: string; lines: string[] } {
  const lines: string[] = [];
  const bySpeeches = [...rows].sort((a, b) => b.speeches - a.speeches);
  const top = bySpeeches[0];
  let headline = `Vos ${plural(rows.length, "député", "députés")} à l'Assemblée : ce qu'ils disent, comment ils votent`;
  if (rows.length > 1 && top.speeches) {
    headline = `${top.fullName}, ${top.feminine ? "la plus présente" : "le plus présent"} à la tribune parmi les ${plural(rows.length, "député", "députés")} du département`;
    lines.push(
      `- **${top.feminine ? "La plus présente" : "Le plus présent"} à la tribune** : ${top.fullName} (${top.partyLabel}), ${plural(top.speeches, "intervention", "interventions")} en séance${top.moreActiveThan !== null ? `, plus que ${fmtPct(top.moreActiveThan)} des députés` : ""}.`,
    );
    const last = bySpeeches[bySpeeches.length - 1];
    if (last !== top) {
      lines.push(
        `- **${last.feminine ? "La plus discrète" : "Le plus discret"} en séance** : ${last.fullName} (${last.partyLabel}), ${plural(last.speeches, "intervention", "interventions")}. Les interventions en séance ne mesurent ni le travail en commission ni la présence en circonscription.`,
      );
    }
  } else if (top?.speeches) {
    lines.push(`- ${top.fullName} (${top.partyLabel}) est intervenu${top.feminine ? "e" : ""} ${plural(top.speeches, "fois", "fois")} en séance.`);
  }
  const free = rows.filter((row) => row.withGroup !== null).sort((a, b) => (a.withGroup as number) - (b.withGroup as number));
  if (free.length > 1 && (free[0].withGroup as number) < 0.95) {
    lines.push(
      `- **${free[0].feminine ? "La plus indépendante" : "Le plus indépendant"} de son groupe** : ${free[0].fullName} vote comme ${free[0].partyLabel} dans ${fmtPct(free[0].withGroup as number)} des scrutins.`,
    );
  }
  const themes = new Map<string, number>();
  for (const row of rows) {
    if (row.theme) {
      themes.set(row.theme, (themes.get(row.theme) || 0) + 1);
    }
  }
  const [theme, count] = [...themes.entries()].sort((a, b) => b[1] - a[1])[0] || ["", 0];
  if (theme && count >= Math.max(2, Math.ceil(rows.length / 3))) {
    lines.push(`- **Le sujet qui revient** : « ${theme} », premier sujet de ${count} des ${plural(rows.length, "député", "députés")}.`);
  }
  // Most striking first: said often by the deputy, rarely by anyone else.
  const exclusivity = (row: OutreachRow) => row.phraseCount / ((row.phraseRest ?? row.phraseCount) + 1);
  const phrases = rows.filter((row) => row.phrase).sort((a, b) => exclusivity(b) - exclusivity(a));
  if (phrases.length) {
    lines.push(
      `- **Les expressions signature** : ${phrases
        .slice(0, 3)
        .map((row) => `« ${row.phrase} » pour ${row.fullName} (${phraseNote(row, "il")})`)
        .join(", ")}.`,
    );
  }
  return { headline, lines };
}

export function departmentDossiers(rows: OutreachRow[], analytics: Analytics, baseURL: string): DepartmentDossier[] {
  const byDept = new Map<string, OutreachRow[]>();
  for (const row of rows) {
    byDept.set(row.dept, [...(byDept.get(row.dept) || []), row]);
  }
  const from = fmtDay(analytics.meta.firstDate);
  const through = fmtDay(analytics.meta.lastDate);
  return [...byDept.entries()].map(([dept, deputies]) => {
    const deptName = deputies[0].deptName;
    const slug = slugify(deptName);
    const { headline, lines } = departmentAngles(deputies);
    const link = withUtm(baseURL, {}, `pqr-${dept}`, "presse");
    const quotes = [...deputies]
      .filter((row) => row.excerpt)
      .sort((a, b) => b.speeches - a.speeches)
      .slice(0, 3)
      .map((row) => {
        const excerpt = row.excerpt as NonNullable<OutreachRow["excerpt"]>;
        return `> « ${excerpt.snippet.trim()} »\n>\n> — ${row.fullName}, ${fmtDay(excerpt.date)}${excerpt.debate ? `, ${excerpt.debate}` : ""} ([compte rendu](${excerpt.url}))`;
      });
    const markdown = [
      `# ${deptName} : ce que disent vos députés à l'Assemblée nationale`,
      "",
      `*Dossier de presse Polititia — séance publique du ${from} au ${through}.*`,
      "",
      `## Titre suggéré`,
      "",
      headline,
      "",
      "## Les angles",
      "",
      ...(lines.length ? lines : ["- Pas encore assez d'interventions en séance pour dégager un angle."]),
      "",
      "## Les députés du département",
      "",
      "| Circ. | Député | Groupe | Interventions | Premier sujet | Expression qui le distingue | Vote avec son groupe |",
      "| --- | --- | --- | ---: | --- | --- | ---: |",
      ...deputies.map(deputyLine),
      "",
      "Fiches individuelles :",
      "",
      ...deputies.map((row) => `- ${row.fullName} : ${withUtm(baseURL, { depute: row.id }, `pqr-${dept}`, "presse")}`),
      "",
      ...(quotes.length ? ["## Ils l'ont dit en séance", "", ...quotes.flatMap((quote) => [quote, ""])] : []),
      "## Méthode",
      "",
      "- Source : comptes rendus intégraux de la séance publique et scrutins publics de l'Assemblée nationale (open data, 17e législature).",
      "- « Interventions » : prises de parole en séance publique, hors commissions.",
      "- « Expression qui le distingue » : groupe de mots (sans les mots outils) que le député emploie nettement plus souvent que le reste de l'Assemblée, dans au moins 3 séances différentes. Les comptes cités portent sur toute la période.",
      "- « Vote avec son groupe » : part des scrutins où le député a voté comme la majorité de son groupe (à partir de 10 scrutins comparables).",
      "- Analyse automatique, reproductible ; chaque citation renvoie au compte rendu officiel.",
      "",
      `Pour explorer les données : ${link}`,
      "",
    ].join("\n");
    return { dept, deptName, slug, file: `${dept}-${slug}.md`, headline, markdown };
  });
}

export function pressIndexCsv(dossiers: DepartmentDossier[], rows: OutreachRow[]): string {
  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(row.dept, (counts.get(row.dept) || 0) + 1);
  }
  return toCsv(
    ["code", "departement", "deputes", "fichier", "titre_suggere"],
    dossiers.map((dossier) => [dossier.dept, dossier.deptName, counts.get(dossier.dept) || 0, `pqr/${dossier.file}`, dossier.headline]),
  );
}
