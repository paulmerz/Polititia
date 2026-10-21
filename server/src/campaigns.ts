import { dayKey } from "./admin.ts";
import type { Store } from "./store.ts";

// Visits brought by a tagged link (utm_source, utm_medium, utm_campaign),
// counted per day and nothing else: no address, no cookie, no visitor id,
// so the counts tell which mailing works without following anyone.

export type Campaign = { source: string; medium: string; campaign: string };

const MAX_LENGTH = 60;
const DAY_MS = 24 * 60 * 60 * 1000;
export const CAMPAIGN_REPORT_DAYS = 90;

// Link previews (WhatsApp, X, LinkedIn…) and scripts fetch the page too; the
// share card already gives them what they need.
const CRAWLER = /bot|crawl|spider|slurp|facebookexternalhit|whatsapp|telegram|slack|discord|skype|preview|embed|bluesky|mastodon|curl|wget|python|httpclient|okhttp|go-http|headless|lighthouse/i;

function clean(value: string | null): string {
  return (value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_LENGTH);
}

export function campaignOf(query: URLSearchParams): Campaign | null {
  const campaign = { source: clean(query.get("utm_source")), medium: clean(query.get("utm_medium")), campaign: clean(query.get("utm_campaign")) };
  return campaign.source || campaign.campaign ? campaign : null;
}

export function isCrawler(request: Request): boolean {
  const agent = request.headers.get("user-agent") || "";
  const purpose = `${request.headers.get("sec-purpose") || ""} ${request.headers.get("purpose") || ""}`;
  return request.method !== "GET" || !agent || CRAWLER.test(agent) || /prefetch|prerender/i.test(purpose);
}

export function recordCampaignVisit(db: Store, campaign: Campaign, now = Date.now()): void {
  db.prepare(
    `INSERT INTO campaign_visits (day, source, medium, campaign, visits) VALUES (?, ?, ?, ?, 1)
     ON CONFLICT (day, source, medium, campaign) DO UPDATE SET visits = visits + 1`,
  ).run(dayKey(now), campaign.source, campaign.medium, campaign.campaign);
}

export type CampaignRow = Campaign & { visits: number; last7: number; firstDay: string; lastDay: string };

export function campaignReport(db: Store, now = Date.now()) {
  const since = dayKey(now - (CAMPAIGN_REPORT_DAYS - 1) * DAY_MS);
  const week = dayKey(now - 6 * DAY_MS);
  const rows = (
    db
      .prepare(
        `SELECT source, medium, campaign, SUM(visits) AS visits,
                SUM(CASE WHEN day >= ? THEN visits ELSE 0 END) AS last7,
                MIN(day) AS firstDay, MAX(day) AS lastDay
         FROM campaign_visits WHERE day >= ?
         GROUP BY source, medium, campaign ORDER BY visits DESC, source, campaign`,
      )
      .all(week, since) as CampaignRow[]
  ).map((row) => ({ ...row, visits: Number(row.visits), last7: Number(row.last7) }));
  const bySource = new Map<string, number>();
  for (const row of rows) {
    bySource.set(row.source || "(aucune)", (bySource.get(row.source || "(aucune)") || 0) + row.visits);
  }
  return {
    days: CAMPAIGN_REPORT_DAYS,
    total: rows.reduce((sum, row) => sum + row.visits, 0),
    sources: [...bySource.entries()].map(([source, visits]) => ({ source, visits })).sort((a, b) => b.visits - a.visits),
    campaigns: rows,
  };
}
