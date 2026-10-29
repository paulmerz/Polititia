import type { Analytics } from "./analytics.ts";
import type { DashboardBundle } from "./data.ts";
import { fitText, type FontMetrics } from "./font.ts";
import { escapeHtml } from "./mailer.ts";
import { signaturePhrase, type ShareKind } from "./share.ts";

// Two sets of images for the launch, both drawn from the same phrases the
// site shows under « Ce qui le distingue ».
//
// The automatic set is one card per group, exactly the phrase the site would
// pick. Several groups mostly say their own name, so that set reads unevenly.
//
// The curated set is the one to post: eight groups, each with a phrase that
// is neither its own name nor a near-tie with the rest of the chamber. The
// choice is listed here on purpose, so it can be reviewed and defended.

const WIDTH = 1080;
const HEIGHT = 1080;
const MARGIN = 84;
const TEXT_WIDTH = WIDTH - 2 * MARGIN;

const COLORS = { bg: "#f6f4ef", ink: "#202428", muted: "#65707a", line: "#d8d6ce", accent: "#b35d32" };

type Party = { id: string; label: string; name?: string; color?: string };
type PhraseRow = { ngram: string; count: number; ratio?: number | null; rest?: number };

export type Slide = {
  file: string;
  party: string;
  color: string;
  name: string;
  phrase: string;
  count: number;
  rest: number;
};

// In the order the carousel should be swiped.
const SELECTION: Array<{ party: string; phrase: string }> = [
  { party: "LFI_NFP", phrase: "services publics" },
  { party: "EcoS", phrase: "dérèglement climatique" },
  { party: "SOC", phrase: "enfants placés" },
  { party: "GDR", phrase: "droit international" },
  { party: "DR", phrase: "suicide assisté" },
  { party: "UDR", phrase: "extrême gauche" },
  { party: "RN", phrase: "pouvoir achat" },
  { party: "NI", phrase: "élus locaux" },
];

function partyOf(bundle: DashboardBundle, id: string): Party | undefined {
  return (bundle.parties as Party[]).find((party) => party.id === id);
}

function findPhrase(analytics: Analytics, bundle: DashboardBundle, partyId: string, phrase: string): PhraseRow | null {
  const view = analytics.party(partyId, analytics.period(null, null));
  const rows = ["2", "3", "4"].flatMap((size) => (view?.words?.distinctive?.[size] as PhraseRow[] | undefined) || []);
  return rows.find((row) => row.ngram === phrase) || null;
}

const NUMBER = new Intl.NumberFormat("fr-FR");

function fmtInt(value: number): string {
  return NUMBER.format(Math.round(value)).replaceAll("\u202f", "\u00a0");
}

export function carouselSlides(analytics: Analytics, bundle: DashboardBundle): Slide[] {
  return SELECTION.map((item, index) => {
    const party = partyOf(bundle, item.party);
    const row = findPhrase(analytics, bundle, item.party, item.phrase);
    if (!party || !row || row.rest === undefined) {
      throw new Error(`Carousel phrase not found: ${item.party} / ${item.phrase}`);
    }
    return {
      file: `${String(index + 1).padStart(2, "0")}-${party.label.toLocaleLowerCase("fr").replace(/[^a-z0-9]+/g, "-")}.png`,
      party: party.label,
      color: party.color || COLORS.accent,
      name: party.name || party.label,
      phrase: row.ngram,
      count: row.count,
      rest: row.rest,
    };
  });
}

function svgText(value: string): string {
  return escapeHtml(value);
}

function textLines(lines: string[], x: number, y: number, size: number, lineHeight: number, attrs: string): string {
  return lines
    .map((line, index) => `<text x="${x}" y="${(y + index * lineHeight).toFixed(1)}" font-size="${size}" ${attrs}>${svgText(line)}</text>`)
    .join("");
}

export function slideSvg(slide: Slide, index: number, total: number, fonts: { regular: FontMetrics; bold: FontMetrics }): string {
  const phrase = fitText(fonts.bold, `« ${slide.phrase} »`, [92, 76, 64], TEXT_WIDTH, 2);
  const name = fitText(fonts.regular, slide.name, [34], TEXT_WIDTH - 60, 1);
  const note = fitText(
    fonts.regular,
    `${fmtInt(slide.count)} fois, contre ${fmtInt(slide.rest)} pour tous les autres orateurs réunis`,
    [36, 32],
    TEXT_WIDTH,
    2,
  );
  const parts = [
    `<rect width="${WIDTH}" height="${HEIGHT}" fill="${COLORS.bg}"/>`,
    `<rect width="${WIDTH}" height="22" fill="${escapeHtml(slide.color)}"/>`,
    `<text x="${MARGIN}" y="150" font-size="26" font-weight="700" letter-spacing="3" fill="${COLORS.accent}">POLITITIA · ${svgText(slide.party.toUpperCase())}</text>`,
    `<circle cx="${MARGIN + 16}" cy="214" r="16" fill="${escapeHtml(slide.color)}"/>`,
    `<text x="${MARGIN + 50}" y="226" font-size="${name.size}" fill="${COLORS.muted}">${svgText(name.lines[0])}</text>`,
    `<text x="${MARGIN}" y="360" font-size="30" fill="${COLORS.muted}">L'expression qui distingue le groupe</text>`,
    textLines(phrase.lines, MARGIN, 470, phrase.size, phrase.size * 1.12, `font-weight="700" fill="${COLORS.ink}"`),
    textLines(note.lines, MARGIN, 800, note.size, note.size * 1.3, `fill="${COLORS.ink}"`),
    `<rect x="${MARGIN}" y="900" width="${TEXT_WIDTH}" height="2" fill="${COLORS.line}"/>`,
    `<text x="${MARGIN}" y="970" font-size="28" fill="${COLORS.muted}">${index + 1} / ${total}</text>`,
    `<text x="${WIDTH - MARGIN}" y="970" font-size="28" font-weight="700" text-anchor="end" fill="${COLORS.accent}">polititia.fr</text>`,
  ];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" font-family="Inter">${parts.join("")}</svg>`;
}

export function carouselCaption(slides: Slide[]): string {
  const lines = slides.map(
    (slide, index) => `${index + 1}. ${slide.party} : « ${slide.phrase} », ${fmtInt(slide.count)} fois contre ${fmtInt(slide.rest)}`,
  );
  return [
    "L'expression qui distingue chaque groupe",
    "",
    "Sélection pour le carrousel de lancement. Chaque expression est celle que le groupe",
    "emploie nettement plus que les autres, hors nom du groupe lui-même. Les chiffres",
    "comptent les prises de parole depuis le 19 juillet 2024. Source : comptes rendus",
    "officiels de l'Assemblée nationale, polititia.fr.",
    "",
    ...lines,
    "",
  ].join("\n");
}

// Re-exported so the export script can build the automatic set from one place.
export type { ShareKind };
export { signaturePhrase };
