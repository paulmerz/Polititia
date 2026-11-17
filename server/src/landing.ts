import type { Analytics } from "./analytics.ts";
import type { DashboardBundle } from "./data.ts";
import { escapeHtml } from "./mailer.ts";
import { fmtDay, fmtInt } from "./outreach.ts";

export const LANDING_PAGE = "accueil.html";
const FIGURES_SLOT = "<!-- chiffres-cles -->";
// Fixed by the electoral code (art. LO 119). The data cannot give it: it only
// lists deputies who spoke, former ones included.
export const SEATS = 577;

// "/" opens the dashboard as soon as the link carries its state (a shared
// deputy, an emailed link coming back with ?suivre= or ?verifie=...):
// campaign tags alone still land on the home page.
export function opensDashboard(query: URLSearchParams): boolean {
  return [...query.keys()].some((key) => !key.startsWith("utm_"));
}

function wordsText(words: number): string {
  if (words < 1_000_000) {
    return fmtInt(words);
  }
  return `${(words / 1_000_000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} millions`;
}

export function landingFigures(bundle: DashboardBundle | null, analytics: Analytics | null): string {
  const meta = (bundle?.meta || {}) as { totalSpeeches?: number; totalWords?: number };
  const figures: Array<[string, string]> = [];
  if (meta.totalSpeeches) {
    figures.push([fmtInt(meta.totalSpeeches), "interventions analysées"]);
  }
  if (meta.totalWords) {
    figures.push([wordsText(meta.totalWords), "mots prononcés"]);
  }
  figures.push([fmtInt(SEATS), "députés"]);
  if (analytics?.meta.lastDate) {
    figures.push([fmtDay(analytics.meta.lastDate), "dernière séance analysée"]);
  }
  if (!meta.totalSpeeches && !analytics) {
    return "";
  }
  const items = figures
    .map(([value, label]) => `<div class="landing-figure"><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></div>`)
    .join("");
  return `<div class="landing-figures">${items}</div>`;
}

export function withLandingFigures(html: string, bundle: DashboardBundle | null, analytics: Analytics | null): string {
  return html.replace(FIGURES_SLOT, landingFigures(bundle, analytics));
}
