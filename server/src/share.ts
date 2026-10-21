import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initWasm, Resvg } from "@resvg/resvg-wasm";
import type { Analytics } from "./analytics.ts";
import type { DashboardBundle } from "./data.ts";
import { fitText, FontMetrics } from "./font.ts";
import { escapeHtml } from "./mailer.ts";

// Share cards: the Open Graph tags of the dashboard page and the 1200×630 PNG
// that WhatsApp, X, LinkedIn or Bluesky show next to a shared link. Crawlers
// do not run JavaScript, so both are built on the server from the query string
// the dashboard writes (?depute=…, ?groupe=…, ?theme=…).

const FONT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "assets", "fonts");
const WIDTH = 1200;
const HEIGHT = 630;
const MARGIN = 80;
const TEXT_WIDTH = WIDTH - 2 * MARGIN;
const CACHE_LIMIT = 300;
const COLORS = { bg: "#f6f4ef", ink: "#202428", muted: "#65707a", line: "#d8d6ce", accent: "#b35d32", accentDark: "#783b22" };
const SITE_NAME = "Polititia";
const TAGLINE = "La parole des députés";
const NON_DEPUTY_PARTIES = new Set(["GOUV", "UNLABELED"]);

export type ShareKind = "depute" | "groupe" | "theme" | "accueil";

type Person = { id: string; name: string; party: string; speechCount?: number; seat?: Seat };
type Seat = { dept: string; deptName: string; circo: number; current: boolean };
type Party = { id: string; label: string; name?: string; color?: string };
type PhraseRow = { ngram: string; count: number; ratio?: number | null; rest?: number };

type Card = {
  accent: string;
  kicker: string;
  title: string;
  tag?: { label: string; color: string; detail: string };
  quote?: { label: string; text: string; note: string };
  lead?: string;
  stats: string[];
};

type Engine = { fonts: Uint8Array[]; regular: FontMetrics; bold: FontMetrics };

let engine: Promise<Engine> | null = null;

function loadEngine(): Promise<Engine> {
  engine ||= (async () => {
    const require = createRequire(import.meta.url);
    await initWasm(readFileSync(require.resolve("@resvg/resvg-wasm/index_bg.wasm")));
    const regular = readFileSync(path.join(FONT_DIR, "Inter-Regular.ttf"));
    const bold = readFileSync(path.join(FONT_DIR, "Inter-Bold.ttf"));
    return { fonts: [regular, bold], regular: new FontMetrics(regular), bold: new FontMetrics(bold) };
  })();
  return engine;
}

// ------------------------------------------------------------------ text

const NUMBER = new Intl.NumberFormat("fr-FR");

// Inter has no narrow no-break space glyph.
function drawable(text: string): string {
  return text.replaceAll("\u202f", "\u00a0");
}

function fmtInt(value: number): string {
  return drawable(NUMBER.format(Math.round(value)));
}

function fmtPct(share: number): string {
  return `${fmtInt(share * 100)}\u00a0%`;
}

function fmtRatio(ratio: number): string {
  return ratio >= 10 ? fmtInt(ratio) : drawable(ratio.toLocaleString("fr-FR", { maximumFractionDigits: 1 }));
}

function plural(count: number, singular: string, pluralForm: string): string {
  return `${fmtInt(count)} ${count > 1 ? pluralForm : singular}`;
}

function ordinal(number: number, feminine = true): string {
  return number === 1 ? (feminine ? "1re" : "1er") : `${number}e`;
}

function quoted(text: string): string {
  return `«\u00a0${text}\u00a0»`;
}

function isFeminine(name: string): boolean {
  return /^(mme|mlle)\b/i.test(name.trim());
}

// "M. Alain David" -> "Alain David"
function withoutCivility(name: string): string {
  return name.replace(/^(m\.|mme|mlle)\s+/i, "").trim();
}

function seatLine(seat: Seat | undefined): string {
  if (!seat) {
    return "";
  }
  if (seat.dept === "099") {
    return `Français de l'étranger, ${ordinal(seat.circo)} circonscription`;
  }
  return `${seat.deptName}, ${ordinal(seat.circo)} circonscription`;
}

export function phraseNote(phrase: PhraseRow): string {
  const form = headlineForm(phrase);
  if (form === "ratio") {
    return `${fmtRatio(phrase.ratio as number)} fois plus souvent que le reste de l'Assemblée`;
  }
  if (form === null) {
    return "";
  }
  const said = `${plural(phrase.count, "fois", "fois")}`;
  return phrase.rest === 0
    ? `${said}, et par aucun autre orateur`
    : `${said}, contre ${fmtInt(phrase.rest as number)} pour tous les autres orateurs réunis`;
}

// Same rule as signatureRow in dashboard/app.js: the card shows the first
// phrase of « Ce qui le distingue » that can be stated plainly. The raw counts
// when everyone else combined said it at most 5 times as often ("17 times,
// against 19 for all the other speakers"), else a stable ratio. "5 times,
// against 461" would read as the opposite of distinctive. Ratios above 100
// come from speakers who barely speak and read as a bug, so the counts say it.
const MERGE_SIZES = ["4", "3", "2"];
const MERGE_LIMIT = 15;
const COUNTS_MAX_REST_FACTOR = 5;
const HEADLINE_MAX_RATIO = 100;

export function headlineForm(row: PhraseRow): "counts" | "ratio" | null {
  if (row.rest !== undefined && (row.rest <= COUNTS_MAX_REST_FACTOR * row.count || (row.ratio || 0) > HEADLINE_MAX_RATIO)) {
    return "counts";
  }
  return row.ratio ? "ratio" : null;
}
function containsPhrase(longer: string, shorter: string): boolean {
  return ` ${longer} `.includes(` ${shorter} `);
}

export function signaturePhrase(bySize: Record<string, PhraseRow[]> | undefined): PhraseRow | null {
  const candidates = MERGE_SIZES.flatMap((size) => (bySize?.[size] || []).map((row) => ({ ...row, size: Number(size) }))).sort(
    (a, b) => b.count - a.count || b.size - a.size,
  );
  const kept: typeof candidates = [];
  for (const row of candidates) {
    const overlap = kept.findIndex((other) => containsPhrase(other.ngram, row.ngram) || containsPhrase(row.ngram, other.ngram));
    if (overlap >= 0) {
      if (row.size > kept[overlap].size && row.count >= 0.5 * kept[overlap].count) {
        kept[overlap] = row;
      }
      continue;
    }
    if (kept.length < MERGE_LIMIT) {
      kept.push(row);
    }
  }
  const merged = kept.filter(
    (row, index) => !kept.some((other, otherIndex) => otherIndex !== index && other.size > row.size && containsPhrase(other.ngram, row.ngram)),
  );
  return merged.find((row) => headlineForm(row) !== null) || null;
}

// ------------------------------------------------------------------ cards

function partyOf(bundle: DashboardBundle | null, id: string): Party | null {
  const parties = (bundle?.parties || []) as Party[];
  return parties.find((party) => party.id === id) || null;
}

function personOf(bundle: DashboardBundle | null, id: string): Person | null {
  return ((bundle?.politicians || []) as unknown as Person[]).find((person) => person.id === id) || null;
}

function homeCard(bundle: DashboardBundle | null): Card {
  const meta = (bundle?.meta || {}) as { deputies?: number; totalSpeeches?: number };
  return {
    accent: COLORS.accent,
    kicker: TAGLINE,
    title: "Ce que votre député dit vraiment.",
    lead: "Et s'il vote comme il parle. Ses sujets, ses expressions, ses votes : chaque intervention en séance, analysée à partir des comptes rendus officiels.",
    stats: [
      meta.deputies ? plural(meta.deputies, "député", "députés") : "",
      meta.totalSpeeches ? plural(meta.totalSpeeches, "intervention analysée", "interventions analysées") : "",
    ].filter(Boolean),
  };
}

function politicianCard(analytics: Analytics | null, bundle: DashboardBundle | null, id: string): Card | null {
  const person = personOf(bundle, id);
  const view = analytics?.politician(id, analytics.period(null, null));
  if (!person && !view) {
    return null;
  }
  const name = view?.name || person?.name || id;
  const partyId = view?.party || person?.party || "";
  const party = partyOf(bundle, partyId);
  const feminine = isFeminine(name);
  const seat = person?.seat;
  const role = NON_DEPUTY_PARTIES.has(partyId)
    ? partyId === "GOUV"
      ? "Membre du Gouvernement"
      : "Intervenant à l'Assemblée"
    : `${seat && !seat.current ? (feminine ? "Ancienne " : "Ancien ") : ""}${feminine ? "Députée" : "Député"}`;
  const phrase = signaturePhrase(view?.words?.distinctive as Record<string, PhraseRow[]> | undefined);
  const speeches = view?.activity.speeches ?? person?.speechCount ?? 0;
  const votes = view?.votes;
  const stats = [plural(speeches, "intervention en séance", "interventions en séance")];
  if (votes && votes.comparable >= 10) {
    stats.push(`vote comme son groupe : ${fmtPct(votes.withGroup / votes.comparable)}`);
  }
  return {
    accent: party?.color || COLORS.accent,
    kicker: role,
    title: withoutCivility(name),
    tag: party ? { label: party.label, color: party.color || COLORS.muted, detail: seatLine(seat) } : undefined,
    quote: phrase
      ? {
          label: feminine ? "L'expression qui la distingue" : "L'expression qui le distingue",
          text: quoted(phrase.ngram),
          note: phraseNote(phrase),
        }
      : undefined,
    lead: phrase ? undefined : "Ses sujets, ses expressions, ses votes et ses annonces de vote, à partir des comptes rendus officiels.",
    stats,
  };
}

function partyCard(analytics: Analytics | null, bundle: DashboardBundle | null, id: string): Card | null {
  const party = partyOf(bundle, id);
  const view = analytics?.party(id, analytics.period(null, null));
  if (!party && !view) {
    return null;
  }
  const phrase = signaturePhrase(view?.words?.distinctive as Record<string, PhraseRow[]> | undefined);
  const stats: string[] = [];
  if (view) {
    stats.push(plural(view.stats.members, "membre", "membres"), plural(view.stats.speeches, "intervention", "interventions"));
    if (view.cohesion) {
      stats.push(`unité de vote : ${fmtPct(view.cohesion.share)}`);
    }
  }
  return {
    accent: party?.color || COLORS.accent,
    kicker: "Groupe politique",
    title: party?.name || party?.label || id,
    tag: party ? { label: party.label, color: party.color || COLORS.muted, detail: "" } : undefined,
    quote: phrase
      ? {
          label: "L'expression qui distingue le groupe",
          text: quoted(phrase.ngram),
          note: phraseNote(phrase),
        }
      : undefined,
    lead: phrase ? undefined : "Ses sujets, ses votes, ses annonces de vote et son vocabulaire.",
    stats,
  };
}

function themeCard(analytics: Analytics | null, bundle: DashboardBundle | null, id: string): Card | null {
  const view = analytics?.theme(id, analytics.period(null, null));
  if (!view) {
    return null;
  }
  const leader = view.ownership.find((row) => !NON_DEPUTY_PARTIES.has(row.party));
  const party = leader ? partyOf(bundle, leader.party) : null;
  return {
    accent: COLORS.accent,
    kicker: "Thème",
    title: view.label,
    quote:
      leader && party && leader.lift >= 1.15
        ? {
            label: "Le groupe qui en parle le plus",
            text: party.label,
            note: `${fmtRatio(leader.lift)} fois plus que la moyenne de l'Assemblée`,
          }
        : undefined,
    lead: leader && party && leader.lift >= 1.15 ? undefined : "Qui en parle, ce que les groupes en disent et comment ils votent.",
    stats: [
      plural(view.stats.speeches, "intervention", "interventions"),
      plural(view.stats.politicians, "orateur", "orateurs"),
      plural(view.stats.votes, "scrutin", "scrutins"),
    ],
  };
}

export function buildCard(kind: ShareKind, id: string, analytics: Analytics | null, bundle: DashboardBundle | null): Card | null {
  if (kind === "depute") {
    return politicianCard(analytics, bundle, id);
  }
  if (kind === "groupe") {
    return partyCard(analytics, bundle, id);
  }
  if (kind === "theme") {
    return themeCard(analytics, bundle, id);
  }
  return homeCard(bundle);
}

// ------------------------------------------------------------------ SVG

function svgText(value: string): string {
  return escapeHtml(drawable(value));
}

function textLines(lines: string[], x: number, y: number, size: number, lineHeight: number, attrs: string): string {
  return lines
    .map((line, index) => `<text x="${x}" y="${(y + index * lineHeight).toFixed(1)}" font-size="${size}" ${attrs}>${svgText(line)}</text>`)
    .join("");
}

const FOOTER_Y = HEIGHT - 58;
const FOOTER_RULE_Y = FOOTER_Y - 52;

// Successively smaller type until the body clears the footer rule.
const SIZE_STEPS: Array<{ title: number[]; quote: number[]; quoteLines: number; lead: number[] }> = [
  { title: [68, 60], quote: [58, 50], quoteLines: 2, lead: [32] },
  { title: [56, 50], quote: [46, 40], quoteLines: 2, lead: [30] },
  { title: [48, 42], quote: [38, 34], quoteLines: 1, lead: [28] },
];

function cardBody(card: Card, fonts: Pick<Engine, "regular" | "bold">, step: (typeof SIZE_STEPS)[number]) {
  const parts: string[] = [];
  let y = 92;

  const title = fitText(fonts.bold, card.title, step.title, TEXT_WIDTH, card.quote ? 2 : 3);
  y += 26 + title.size;
  parts.push(textLines(title.lines, MARGIN, y, title.size, title.size * 1.12, `font-weight="700" fill="${COLORS.ink}"`));
  y += (title.lines.length - 1) * title.size * 1.12;

  if (card.tag) {
    y += 50;
    const labelWidth = fonts.bold.width(card.tag.label, 26);
    parts.push(
      `<circle cx="${MARGIN + 10}" cy="${(y - 9).toFixed(1)}" r="10" fill="${escapeHtml(card.tag.color)}"/>`,
      `<text x="${MARGIN + 30}" y="${y.toFixed(1)}" font-size="26" font-weight="700" fill="${COLORS.ink}">${svgText(card.tag.label)}</text>`,
    );
    if (card.tag.detail) {
      const detail = fitText(fonts.regular, `· ${card.tag.detail}`, [26], TEXT_WIDTH - labelWidth - 42, 1).lines[0];
      parts.push(
        `<text x="${(MARGIN + 42 + labelWidth).toFixed(1)}" y="${y.toFixed(1)}" font-size="26" fill="${COLORS.muted}">${svgText(detail)}</text>`,
      );
    }
  }

  if (card.quote) {
    y += 58;
    parts.push(`<text x="${MARGIN}" y="${y.toFixed(1)}" font-size="26" fill="${COLORS.muted}">${svgText(card.quote.label)}</text>`);
    const quote = fitText(fonts.bold, card.quote.text, step.quote, TEXT_WIDTH, step.quoteLines);
    y += 14 + quote.size;
    parts.push(textLines(quote.lines, MARGIN, y, quote.size, quote.size * 1.15, `font-weight="700" fill="${COLORS.accentDark}"`));
    y += (quote.lines.length - 1) * quote.size * 1.15;
    if (card.quote.note) {
      y += 42;
      parts.push(`<text x="${MARGIN}" y="${y.toFixed(1)}" font-size="28" fill="${COLORS.ink}">${svgText(card.quote.note)}</text>`);
    }
  } else if (card.lead) {
    y += 60;
    const lead = fitText(fonts.regular, card.lead, step.lead, TEXT_WIDTH, 3);
    parts.push(textLines(lead.lines, MARGIN, y, lead.size, lead.size * 1.35, `fill="${COLORS.muted}"`));
    y += (lead.lines.length - 1) * lead.size * 1.35;
  }
  return { svg: parts.join(""), bottom: y };
}

export function cardSvg(card: Card, host: string, fonts: Pick<Engine, "regular" | "bold">): string {
  const parts: string[] = [
    `<rect width="${WIDTH}" height="${HEIGHT}" fill="${COLORS.bg}"/>`,
    `<rect width="18" height="${HEIGHT}" fill="${escapeHtml(card.accent)}"/>`,
    `<text x="${MARGIN}" y="92" font-size="22" font-weight="700" letter-spacing="3" fill="${COLORS.accent}">${svgText(`${SITE_NAME.toUpperCase()} · ${card.kicker.toUpperCase()}`)}</text>`,
  ];
  let body = cardBody(card, fonts, SIZE_STEPS[0]);
  for (const step of SIZE_STEPS.slice(1)) {
    if (body.bottom <= FOOTER_RULE_Y - 22) {
      break;
    }
    body = cardBody(card, fonts, step);
  }
  parts.push(body.svg);

  const footerY = FOOTER_Y;
  parts.push(`<rect x="${MARGIN}" y="${FOOTER_RULE_Y}" width="${TEXT_WIDTH}" height="2" fill="${COLORS.line}"/>`);
  const hostWidth = fonts.bold.width(host, 26);
  parts.push(
    `<text x="${WIDTH - MARGIN}" y="${footerY}" font-size="26" font-weight="700" text-anchor="end" fill="${COLORS.accent}">${svgText(host)}</text>`,
  );
  const stats = [...card.stats];
  while (stats.length > 1 && fonts.regular.width(stats.join("  ·  "), 26) > TEXT_WIDTH - hostWidth - 40) {
    stats.pop();
  }
  if (stats.length) {
    parts.push(`<text x="${MARGIN}" y="${footerY}" font-size="26" fill="${COLORS.ink}">${svgText(stats.join("  ·  "))}</text>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" font-family="Inter">${parts.join("")}</svg>`;
}

const pngCache = new Map<string, Uint8Array>();

export async function renderCard(card: Card, host: string, cacheKey: string): Promise<Uint8Array> {
  const cached = pngCache.get(cacheKey);
  if (cached) {
    return cached;
  }
  const { fonts, regular, bold } = await loadEngine();
  const svg = cardSvg(card, host, { regular, bold });
  const png = new Resvg(svg, { font: { fontBuffers: fonts, defaultFontFamily: "Inter", loadSystemFonts: false } }).render().asPng();
  pngCache.set(cacheKey, png);
  if (pngCache.size > CACHE_LIMIT) {
    const oldest = pngCache.keys().next().value;
    if (oldest !== undefined) {
      pngCache.delete(oldest);
    }
  }
  return png;
}

export function isCachedCard(cacheKey: string): boolean {
  return pngCache.has(cacheKey);
}

// ------------------------------------------------------------------ page tags

export type ShareTarget = { kind: ShareKind; id: string };

// The view a shared dashboard URL opens, in the order readUrl() in app.js applies them.
export function shareTarget(query: URLSearchParams, bundle: DashboardBundle | null, analytics: Analytics | null): ShareTarget {
  const person = query.get("depute") || "";
  if (person && personOf(bundle, person)) {
    return { kind: "depute", id: person };
  }
  const party = query.get("groupe") || "";
  if (party && partyOf(bundle, party)) {
    return { kind: "groupe", id: party };
  }
  const theme = query.get("theme") || "";
  if (theme && analytics?.themeIds.has(theme)) {
    return { kind: "theme", id: theme };
  }
  return { kind: "accueil", id: "" };
}

function pageText(target: ShareTarget, bundle: DashboardBundle | null, analytics: Analytics | null): { title: string; description: string } {
  if (target.kind === "depute") {
    const person = personOf(bundle, target.id);
    const name = withoutCivility(person?.name || target.id);
    const seat = seatLine(person?.seat);
    return {
      title: `Ce que dit ${name} à l'Assemblée nationale`,
      description: `${person?.speechCount ? `${plural(person.speechCount, "intervention", "interventions")} en séance analysées` : "Ses interventions en séance"}${seat ? ` (${seat})` : ""} : ses sujets, les expressions qui ${isFeminine(person?.name || "") ? "la" : "le"} distinguent, ses votes et ses annonces de vote. Source : comptes rendus officiels.`,
    };
  }
  if (target.kind === "groupe") {
    const party = partyOf(bundle, target.id);
    return {
      title: `Ce que dit le groupe ${party?.label || target.id} à l'Assemblée nationale`,
      description: `${party?.name || party?.label || target.id} : ses sujets, ses votes, ses annonces de vote et les expressions qui le distinguent. Source : comptes rendus officiels.`,
    };
  }
  if (target.kind === "theme") {
    const label = analytics?.themeIds.get(target.id)?.label || target.id;
    return {
      title: `${label} : qui en parle à l'Assemblée et comment votent les groupes`,
      description: `Qui parle de « ${label} », ce que les groupes en disent et comment ils votent. Source : comptes rendus officiels de l'Assemblée nationale.`,
    };
  }
  return {
    title: `${TAGLINE} : ce que votre député dit vraiment`,
    description:
      "Ce que chaque député dit en séance, les expressions qui le distinguent et s'il vote comme il parle. Gratuit, à partir des comptes rendus et des scrutins publics.",
  };
}

export function shareQuery(target: ShareTarget): string {
  const key = { depute: "depute", groupe: "groupe", theme: "theme", accueil: "" }[target.kind];
  return key ? `?${key}=${encodeURIComponent(target.id)}` : "";
}

export function imagePath(target: ShareTarget, version: string): string {
  const base = target.kind === "accueil" ? "/og/accueil.png" : `/og/${target.kind}/${encodeURIComponent(target.id)}.png`;
  return version ? `${base}?v=${encodeURIComponent(version)}` : base;
}

export function headTags(baseURL: string, target: ShareTarget, bundle: DashboardBundle | null, analytics: Analytics | null): string {
  const { title, description } = pageText(target, bundle, analytics);
  const url = `${baseURL}/${shareQuery(target)}`;
  const image = `${baseURL}${imagePath(target, analytics?.meta.builtOn || "")}`;
  const fullTitle = `${title} · ${SITE_NAME}`;
  const tags: Array<[string, string, string]> = [
    ["name", "description", description],
    ["property", "og:type", "website"],
    ["property", "og:site_name", `${SITE_NAME} · ${TAGLINE}`],
    ["property", "og:locale", "fr_FR"],
    ["property", "og:title", title],
    ["property", "og:description", description],
    ["property", "og:url", url],
    ["property", "og:image", image],
    ["property", "og:image:type", "image/png"],
    ["property", "og:image:width", String(WIDTH)],
    ["property", "og:image:height", String(HEIGHT)],
    ["property", "og:image:alt", title],
    ["name", "twitter:card", "summary_large_image"],
    ["name", "twitter:title", title],
    ["name", "twitter:description", description],
    ["name", "twitter:image", image],
  ];
  return [
    `<title>${escapeHtml(fullTitle)}</title>`,
    `<link rel="canonical" href="${escapeHtml(url)}" />`,
    ...tags.map(([attr, key, value]) => `<meta ${attr}="${key}" content="${escapeHtml(value)}" />`),
  ].join("\n    ");
}

export function withHeadTags(html: string, tags: string): string {
  return html.replace(/<title>[^<]*<\/title>/, tags);
}
