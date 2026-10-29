import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { reportUrl, voteUrl, type Analytics } from "./analytics.ts";
import type { DashboardBundle } from "./data.ts";
import { fmtDay, fmtInt, plural, withoutCivility, withUtm } from "./outreach.ts";

// The national press release and, for the journalist offered the exclusive,
// the list of deputies who voted otherwise than they announced. Every figure
// is read from analytics.sqlite, so both files follow each data update.

const NON_DEPUTY_PARTIES = ["GOUV", "UNLABELED"];
// Same rule as stance_vote_agreement in build_analytics_db.py: a speech in a
// joint debate ("Soins palliatifs – Aide à mourir") may announce a vote on the
// other bill, so it is not compared.
const JOINT_DEBATE_SEPARATOR = "\u2013";
const EXPECTED: Record<string, string> = { favorable: "pour", defavorable: "contre", abstention: "abstention" };
const STANCE_LABEL: Record<string, string> = { favorable: "pour", defavorable: "contre", abstention: "abstention" };
const POSITION_LABEL: Record<string, string> = { pour: "a voté pour", contre: "a voté contre" };
const LONG_GAP_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export type PressFigures = {
  speeches: number;
  words: number;
  deputies: number;
  sittings: number;
  firstDate: string;
  lastDate: string;
  compared: number;
  agreeing: number;
};

export type Gap = {
  name: string;
  party: string;
  acteurId: string;
  date: string;
  debate: string;
  quote: string;
  stance: string;
  reportUrl: string;
  vote: { number: number; date: string; title: string; position: string; url: string };
  correction: "none" | "filed" | "unknown";
};

type Announced = { sid: number; pid: number; date: string; sessionUid: string; debate: string; stance: string; vid: number | null };

// Explanations received after we wrote to the deputy. Keyed by acteur id so a
// later data rebuild still prints them under the right name. The wording is
// theirs: it is reproduced, not summarised.
const EXPLANATIONS: Record<string, { received: string; from: string; onBehalfOf: string; paragraphs: string[] }> = {
  PA840889: {
    received: "2026-10-26",
    from: "David Desgouilles",
    onBehalfOf: "Matthieu Bloch",
    paragraphs: [
      "Lors de son intervention du 20 juillet dernier, Monsieur Bloch s'exprimait en qualité d'orateur du groupe UDR. En annonçant que « nous nous abstiendrions », il faisait donc référence à la position majoritaire de son groupe, qui s'est effectivement traduite par 13 abstentions lors du scrutin.",
      "Pour sa part, Monsieur Bloch a fait le choix de voter en faveur du texte, conformément à la liberté de vote dont dispose chaque parlementaire.",
      "Il n'y a donc aucune erreur dans le scrutin public, mais simplement une distinction entre la position qu'il était chargé d'exprimer à la tribune au nom de son groupe et son vote personnel.",
    ],
  },
};

function explanationOf(gap: Gap): string[] {
  const reply = EXPLANATIONS[gap.acteurId];
  if (!reply) {
    return [];
  }
  const quoted = reply.paragraphs.map((paragraph) => `> ${paragraph}`).join("\n>\n");
  return ["", `**Explication reçue le ${fmtDay(reply.received)}.** ${reply.from}, au nom de ${reply.onBehalfOf} :`, "", quoted];
}

export function pressFigures(analytics: Analytics, gapsFound: { compared: number; agreeing: number }): PressFigures {
  const row = analytics.db
    .prepare(
      `SELECT COUNT(*) AS speeches, SUM(words) AS words, COUNT(DISTINCT pid) AS deputies,
              COUNT(DISTINCT session_uid) AS sittings, MIN(date) AS firstDate, MAX(date) AS lastDate
       FROM speeches WHERE party NOT IN (?, ?)`,
    )
    .get(...NON_DEPUTY_PARTIES) as Record<string, number | string>;
  return {
    speeches: Number(row.speeches),
    words: Number(row.words),
    deputies: Number(row.deputies),
    sittings: Number(row.sittings),
    firstDate: String(row.firstDate),
    lastDate: String(row.lastDate),
    ...gapsFound,
  };
}

// A deputy may ask, after the vote, to have it recorded otherwise ("mise au
// point"): the scrutin file of the open data lists those requests.
function correctionFiled(scrutinDir: string | null, number: number, acteurId: string): Gap["correction"] {
  const file = scrutinDir ? path.join(scrutinDir, `VTANR5L17V${number}.json`) : "";
  if (!file || !existsSync(file)) {
    return "unknown";
  }
  const scrutin = (JSON.parse(readFileSync(file, "utf8")) as { scrutin?: { miseAuPoint?: unknown } }).scrutin;
  return JSON.stringify(scrutin?.miseAuPoint || {}).includes(`"${acteurId}"`) ? "filed" : "none";
}

export function announcedVotes(analytics: Analytics, bundle: DashboardBundle, scrutinDir: string | null) {
  const announced = analytics.db
    .prepare(
      `WITH announced AS (
         SELECT DISTINCT s.sid, s.pid, s.date, s.session_uid, s.debate_title, st.stance,
                (SELECT ta.dossier_title FROM theme_attributions ta
                 WHERE ta.sid = s.sid AND ta.dossier_title != '' LIMIT 1) AS dossier
         FROM stances st JOIN speeches s ON s.sid = st.sid
         WHERE instr(s.debate_title, ?) = 0
       )
       SELECT a.sid, a.pid, a.date, a.session_uid AS sessionUid, a.debate_title AS debate, a.stance,
              (SELECT v.vid FROM votes v JOIN vote_positions vp ON vp.vid = v.vid AND vp.pid = a.pid
               WHERE v.dossier_title = a.dossier AND v.is_key = 1 AND v.vote_type != 'MOC' AND v.date >= a.date
               ORDER BY v.date, v.number LIMIT 1) AS vid
       FROM announced a WHERE a.dossier IS NOT NULL`,
    )
    .all(JOINT_DEBATE_SEPARATOR) as Announced[];
  const positionOf = analytics.db.prepare("SELECT position FROM vote_positions WHERE vid = ? AND pid = ?");
  const voteOf = analytics.db.prepare("SELECT number, date, title FROM votes WHERE vid = ?");
  const quoteOf = analytics.db.prepare("SELECT quote FROM stances WHERE sid = ? AND stance = ? LIMIT 1");
  const personOf = analytics.db.prepare("SELECT id, name, acteur_id FROM politicians WHERE pid = ?");
  const parties = new Map((bundle.parties as Array<{ id: string; label?: string }>).map((party) => [party.id, party.label || party.id]));
  const partyOf = new Map(bundle.politicians.map((person) => [String(person.id), String(person.party || "")]));

  let compared = 0;
  const gaps: Gap[] = [];
  for (const item of announced) {
    const position = item.vid === null ? "" : String((positionOf.get(item.vid, item.pid) as { position?: string } | undefined)?.position || "");
    if (!["pour", "contre", "abstention"].includes(position)) {
      continue;
    }
    compared += 1;
    if (EXPECTED[item.stance] === position) {
      continue;
    }
    const vote = voteOf.get(item.vid as number) as { number: number; date: string; title: string };
    const person = personOf.get(item.pid) as { id: string; name: string; acteur_id: string };
    const party = partyOf.get(person.id) || "";
    gaps.push({
      name: withoutCivility(person.name),
      party: parties.get(party) || party,
      acteurId: person.acteur_id,
      date: item.date,
      debate: item.debate,
      quote: String((quoteOf.get(item.sid, item.stance) as { quote?: string } | undefined)?.quote || ""),
      stance: item.stance,
      reportUrl: reportUrl(item.sessionUid),
      vote: { number: Number(vote.number), date: vote.date, title: vote.title, position, url: voteUrl(Number(vote.number)) },
      correction: correctionFiled(scrutinDir, Number(vote.number), person.acteur_id),
    });
  }
  gaps.sort((a, b) => a.date.localeCompare(b.date));
  return { compared, agreeing: compared - gaps.length, gaps };
}

function pct(part: number, whole: number): string {
  return whole ? `${Math.round((100 * part) / whole)} %` : "—";
}

function millions(value: number): string {
  return (value / 1_000_000).toLocaleString("fr-FR", { maximumFractionDigits: 1 });
}

export function pressRelease(figures: PressFigures, baseURL: string, launchDay: string): string {
  const link = withUtm(baseURL, {}, "communique", "presse");
  const site = new URL("/", baseURL).toString().replace(/\/$/, "");
  return `# COMMUNIQUÉ DE PRESSE

**Pour diffusion le ${fmtDay(launchDay)} à 7 h**

## Ce que disent vraiment les députés : Polititia rend lisible la parole de l'hémicycle

Paris, le ${fmtDay(launchDay)}. Polititia met en ligne « La parole des députés », un outil gratuit qui analyse chaque intervention des députés en séance publique depuis le début de la XVIIe législature : ${fmtInt(figures.speeches)} prises de parole et ${millions(figures.words)} millions de mots, prononcés par ${fmtInt(figures.deputies)} députés au cours de ${fmtInt(figures.sittings)} séances, du ${fmtDay(figures.firstDate)} au ${fmtDay(figures.lastDate)}.

En quelques secondes, chacun peut savoir :

- de quoi parle son député, et à quel point ;
- quelles expressions le distinguent des autres orateurs ;
- s'il vote comme son groupe, et comme il l'avait annoncé.

Il suffit de taper le nom de sa commune ou son code postal pour retrouver son député.

**Premier enseignement : les députés votent comme ils l'annoncent.** Quand un député annonce son vote en séance (« nous voterons contre ce texte », « je m'abstiendrai »), il vote ensuite comme annoncé dans ${pct(figures.agreeing, figures.compared)} des cas (${fmtInt(figures.agreeing)} sur ${fmtInt(figures.compared)}).

Les données sont publiques (comptes rendus et scrutins de l'Assemblée nationale), la méthode aussi. Chaque citation renvoie au compte rendu officiel, et les règles de calcul ont été vérifiées à la main : 98,9 % de précision pour le classement des interventions par thème, 98 % pour les annonces de vote repérées.

- Le site : ${link}
- La méthode : ${site}/methode
- Qui sommes-nous : ${site}/a-propos

**Contact presse :** [À compléter : nom, téléphone, email]

**À propos de Polititia :** [À compléter : deux lignes sur qui porte le projet et son indépendance]
`;
}

// Stored quotes are cut at a fixed length, sometimes mid-sentence or
// mid-parenthesis: keep up to the last complete sentence.
function cleanQuote(quote: string): string {
  const spoken = quote.replace(/\s*\([^()]*$/, "").trimEnd();
  const end = Math.max(spoken.lastIndexOf("."), spoken.lastIndexOf("?"), spoken.lastIndexOf("!"));
  return end > 0 ? spoken.slice(0, end + 1) : `${spoken.replace(/[^\p{L}\p{N})»"']+$/u, "")}…`;
}

function positionLabel(gap: Gap): string {
  if (gap.vote.position !== "abstention") {
    return POSITION_LABEL[gap.vote.position];
  }
  return /e$/.test(gap.name.split(" ")[0]) ? "s'est abstenue" : "s'est abstenu";
}

function gapContext(gap: Gap): string[] {
  const notes = [];
  const days = Math.round((Date.parse(gap.vote.date) - Date.parse(gap.date)) / DAY_MS);
  if (days === 0) {
    notes.push("L'annonce et le vote ont eu lieu le même jour.");
  } else if (/commission mixte paritaire/i.test(gap.vote.title)) {
    notes.push(`Le vote porte sur le texte de compromis de la commission mixte paritaire, ${plural(days, "jour", "jours")} après l'annonce : le texte a pu changer entre-temps.`);
  } else if (days > LONG_GAP_DAYS) {
    notes.push(`Le vote a eu lieu ${plural(days, "jour", "jours")} après l'annonce : le texte a pu être modifié entre-temps.`);
  } else {
    notes.push(`Le vote a eu lieu ${plural(days, "jour", "jours")} après l'annonce.`);
  }
  notes.push(
    {
      none: "Aucune correction de vote (« mise au point ») n'est enregistrée pour ce député sur ce scrutin.",
      filed: "Le député a déposé une correction de vote (« mise au point ») sur ce scrutin : son intention de vote diffère du vote enregistré.",
      unknown: "Corrections de vote (« mises au point ») non vérifiées : données brutes du scrutin absentes.",
    }[gap.correction],
  );
  return notes;
}

export function gapsNote(figures: PressFigures, gaps: Gap[], baseURL: string): string {
  const site = new URL("/", baseURL).toString().replace(/\/$/, "");
  const cases = gaps.map((gap, index) =>
    [
      `### ${index + 1}. ${gap.name} (${gap.party})`,
      "",
      `- **Annonce, le ${fmtDay(gap.date)}** (débat « ${gap.debate} ») : « ${cleanQuote(gap.quote)} » Position annoncée : ${STANCE_LABEL[gap.stance]}. [Compte rendu](${gap.reportUrl})`,
      `- **Vote, le ${fmtDay(gap.vote.date)}** : ${positionLabel(gap)} sur ${gap.vote.title} [Scrutin n° ${gap.vote.number}](${gap.vote.url})`,
      ...gapContext(gap).map((line) => `- ${line}`),
      ...explanationOf(gap),
      "",
    ].join("\n"),
  );
  const awaiting = gaps.filter((gap) => !EXPLANATIONS[gap.acteurId]).length;
  return `# Annonces de vote et votes réels : les écarts

Note réservée au média qui reçoit l'exclusivité. Données du ${fmtDay(figures.firstDate)} au ${fmtDay(figures.lastDate)}.

Quand un député annonce explicitement son vote en séance, nous le comparons à son vote sur l'ensemble du même texte (premier scrutin public sur l'ensemble du texte après l'annonce). Sur ${fmtInt(figures.compared)} annonces comparables, ${fmtInt(figures.agreeing)} ont été suivies d'un vote conforme (${pct(figures.agreeing, figures.compared)}). Voici ${gaps.length > 1 ? `les ${gaps.length} autres` : "l'autre"}.

**Avant publication :**

- Un écart n'est pas forcément un revirement : le texte voté peut différer de celui débattu (amendements, commission mixte paritaire), un député peut parler au nom de son groupe puis voter autrement, et il peut se tromper de bouton.
- ${awaiting === gaps.length ? "Nous recommandons de demander leur explication aux députés concernés avant de les citer." : awaiting === 0 ? "Chaque député concerné a répondu : son explication est reproduite sous son nom et doit être citée avec le constat." : "L'explication déjà reçue est reproduite sous le nom du député et doit être citée avec le constat. Pour les autres, demandez la leur avant de les citer."}
- Les débats communs à deux textes (par exemple « Soins palliatifs – Aide à mourir ») sont exclus du calcul : une annonce y peut porter sur l'un ou l'autre texte.
- Les votes à main levée ne sont pas enregistrés nominativement et ne peuvent donc pas être comparés.

## Les écarts

${cases.join("\n")}
Méthode complète : ${site}/methode
`;
}
