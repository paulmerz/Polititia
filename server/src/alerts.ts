import type { Analytics } from "./analytics.ts";
import type { AppConfig } from "./config.ts";
import type { DashboardBundle } from "./data.ts";
import { markNotified, unsubscribeUrl } from "./follows.ts";
import { escapeHtml, sendEmail, type OutgoingEmail } from "./mailer.ts";
import type { Store } from "./store.ts";

// The « Suivre mon député » email: one message per account, listing what each
// followed deputy said and voted since the previous alert. It is sent after
// each corpus update, from /admin or with `npm run alerts`.

type Digest = NonNullable<ReturnType<Analytics["digest"]>>;
type Recipient = { userId: string; email: string; items: Digest[]; follows: number };

export type AlertRun = {
  through: string;
  recipients: number;
  sent: number;
  failed: number;
  upToDate: number;
  preview: Array<{ email: string; subject: string; deputies: string[] }>;
};

const SEND_INTERVAL_MS = 600;
const PREVIEW_LIMIT = 20;
const SNIPPET_MAX = 320;
const DATE = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", timeZone: "UTC" });
const NUMBER = new Intl.NumberFormat("fr-FR");
const POSITIONS: Record<string, string> = { pour: "pour", contre: "contre", abstention: "abstention" };

function fmtDay(day: string): string {
  return DATE.format(new Date(`${day}T00:00:00Z`)).replace(/^1 /, "1er ");
}

function plural(count: number, singular: string, pluralForm: string): string {
  return `${NUMBER.format(count)} ${count > 1 ? pluralForm : singular}`;
}

function displayName(name: string): string {
  return name.replace(/^(m\.|mme|mlle)\s+/i, "").trim();
}

function partyLabel(bundle: DashboardBundle | null, party: string): string {
  const parties = (bundle?.parties || []) as Array<{ id: string; label?: string }>;
  return parties.find((item) => item.id === party)?.label || party;
}

function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) {
    return clean;
  }
  const cut = clean.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max - 20))}…`;
}

function hasNews(item: Digest): boolean {
  return item.speeches > 0 || item.votes.cast > 0;
}

// Accounts with at least one follow; blocked accounts get nothing.
export function collectAlerts(db: Store, analytics: Analytics): { through: string; recipients: Recipient[]; upToDate: number } {
  const through = analytics.meta.lastDate;
  const rows = db
    .prepare(
      `SELECT f.user_id AS userId, u.email, f.politician_id AS politicianId, f.notified_through AS notifiedThrough
       FROM follows f JOIN "user" u ON u.id = f.user_id
       WHERE f.user_id NOT IN (SELECT user_id FROM user_blocks)
       ORDER BY f.user_id, f.created_at, f.politician_id`,
    )
    .all() as Array<{ userId: string; email: string; politicianId: string; notifiedThrough: string }>;
  const digests = new Map<string, Digest | null>();
  const byUser = new Map<string, Recipient>();
  for (const row of rows) {
    const recipient = byUser.get(row.userId) || { userId: row.userId, email: row.email, items: [], follows: 0 };
    byUser.set(row.userId, recipient);
    recipient.follows += 1;
    if (!through || row.notifiedThrough >= through) {
      continue;
    }
    const key = `${row.politicianId}:${row.notifiedThrough}`;
    if (!digests.has(key)) {
      digests.set(key, analytics.digest(row.politicianId, row.notifiedThrough));
    }
    const digest = digests.get(key);
    if (digest && hasNews(digest)) {
      recipient.items.push(digest);
    }
  }
  const all = [...byUser.values()];
  return { through, recipients: all.filter((recipient) => recipient.items.length), upToDate: all.filter((recipient) => !recipient.items.length).length };
}

function subjectFor(items: Digest[]): string {
  if (items.length > 1) {
    return `Du nouveau pour ${items.length} députés que vous suivez`;
  }
  const [item] = items;
  const name = displayName(item.name);
  const since = fmtDay(item.from);
  if (item.speeches) {
    return `${name} a pris la parole ${item.speeches > 1 ? `${NUMBER.format(item.speeches)} fois` : "en séance"} depuis le ${since}`;
  }
  return `${name} a voté ${plural(item.votes.cast, "fois", "fois")} depuis le ${since}`;
}

function itemSummary(item: Digest): string {
  const parts = [];
  if (item.speeches) {
    parts.push(`${plural(item.speeches, "intervention", "interventions")} en séance (${plural(item.words, "mot", "mots")})`);
  }
  if (item.votes.cast) {
    parts.push(plural(item.votes.cast, "vote", "votes"));
  }
  return `Depuis le ${fmtDay(item.from)} : ${parts.join(", ")}.`;
}

function voteLine(vote: { title: string; position?: string; groupPosition?: string }): string {
  const position = POSITIONS[vote.position || ""] || vote.position || "";
  const group = POSITIONS[vote.groupPosition || ""];
  return `${vote.title} : ${position}${group && group !== position ? ` (son groupe : ${group})` : ""}`;
}

export function alertEmail(config: AppConfig, bundle: DashboardBundle | null, recipient: Recipient): OutgoingEmail {
  const unsubscribeAll = unsubscribeUrl(config.baseURL, config.secret, recipient.userId);
  const html: string[] = [
    `<div style="font-family:Inter,Arial,sans-serif;color:#202428;max-width:640px;line-height:1.5">`,
    `<p style="color:#b35d32;font-weight:700;letter-spacing:.08em;text-transform:uppercase;font-size:12px">Polititia · La parole des députés</p>`,
  ];
  const text: string[] = ["Polititia · La parole des députés", ""];
  for (const item of recipient.items) {
    const name = displayName(item.name);
    const party = partyLabel(bundle, item.party);
    const fiche = `${config.baseURL}/?depute=${encodeURIComponent(item.id)}`;
    const stop = unsubscribeUrl(config.baseURL, config.secret, recipient.userId, item.id);
    html.push(
      `<h2 style="margin:24px 0 4px;font-size:20px">${escapeHtml(name)} <span style="color:#65707a;font-size:14px;font-weight:400">${escapeHtml(party)}</span></h2>`,
      `<p style="margin:0 0 8px">${escapeHtml(itemSummary(item))}</p>`,
    );
    text.push(`${name} (${party})`, itemSummary(item));
    if (item.themes.length) {
      const themes = item.themes.map((theme) => `${theme.label} (${theme.speechCount})`).join(", ");
      html.push(`<p style="margin:0 0 8px">Ses sujets : ${escapeHtml(themes)}</p>`);
      text.push(`Ses sujets : ${themes}`);
    }
    for (const excerpt of item.excerpts) {
      const snippet = truncate(excerpt.snippet, SNIPPET_MAX);
      const where = [fmtDay(excerpt.date), excerpt.debate].filter(Boolean).join(" · ");
      html.push(
        `<blockquote style="margin:8px 0;padding:8px 12px;border-left:3px solid #b35d32;background:#f6f4ef">« ${escapeHtml(snippet)} »` +
          `<br><small style="color:#65707a">${escapeHtml(where)} · <a href="${escapeHtml(excerpt.url)}" style="color:#783b22">compte rendu</a></small></blockquote>`,
      );
      text.push(`« ${snippet} »`, `${where} : ${excerpt.url}`);
    }
    const votes = [...item.votes.deviations.map((vote) => ({ ...vote, deviates: true })), ...item.votes.keyVotes].filter(
      (vote, index, all) => all.findIndex((other) => other.number === vote.number) === index,
    );
    if (votes.length) {
      html.push(`<p style="margin:8px 0 4px;font-weight:700">Ses votes à retenir</p><ul style="margin:0;padding-left:20px">`);
      text.push("Ses votes à retenir :");
      for (const vote of votes.slice(0, 4)) {
        const line = voteLine(vote);
        html.push(`<li><a href="${escapeHtml(vote.url)}" style="color:#202428">${escapeHtml(line)}</a></li>`);
        text.push(`- ${line} ${vote.url}`);
      }
      html.push("</ul>");
    }
    html.push(
      `<p style="margin:12px 0 0"><a href="${escapeHtml(fiche)}" style="display:inline-block;padding:8px 14px;border-radius:999px;background:#b35d32;color:#fff;text-decoration:none;font-weight:700">Voir sa fiche</a>` +
        ` <a href="${escapeHtml(stop)}" style="margin-left:12px;color:#65707a;font-size:13px">Ne plus suivre ${escapeHtml(name)}</a></p>`,
    );
    text.push(`Voir sa fiche : ${fiche}`, `Ne plus suivre : ${stop}`, "");
  }
  html.push(
    `<hr style="margin:28px 0 12px;border:0;border-top:1px solid #d8d6ce">`,
    `<p style="color:#65707a;font-size:12px">Vous recevez cet email parce que vous suivez ${plural(recipient.follows, "député", "députés")} sur Polititia. ` +
      `Analyse automatique des comptes rendus et des scrutins publics de l'Assemblée nationale. ` +
      `<a href="${escapeHtml(unsubscribeAll)}" style="color:#65707a">Ne plus recevoir aucune alerte</a>.</p></div>`,
  );
  text.push("--", `Vous recevez cet email parce que vous suivez des députés sur Polititia. Ne plus recevoir aucune alerte : ${unsubscribeAll}`);
  return {
    to: recipient.email,
    subject: subjectFor(recipient.items),
    html: html.join(""),
    text: text.join("\n"),
    headers: { "List-Unsubscribe": `<${unsubscribeAll}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
  };
}

type SendOptions = {
  dryRun?: boolean;
  send?: (config: AppConfig, email: OutgoingEmail) => Promise<void>;
  intervalMs?: number;
};

export async function sendFollowAlerts(
  config: AppConfig,
  db: Store,
  analytics: Analytics,
  bundle: DashboardBundle | null,
  { dryRun = false, send = sendEmail, intervalMs = SEND_INTERVAL_MS }: SendOptions = {},
): Promise<AlertRun> {
  const { through, recipients, upToDate } = collectAlerts(db, analytics);
  const run: AlertRun = { through, recipients: recipients.length, sent: 0, failed: 0, upToDate, preview: [] };
  for (const recipient of recipients) {
    const email = alertEmail(config, bundle, recipient);
    if (run.preview.length < PREVIEW_LIMIT) {
      run.preview.push({ email: recipient.email, subject: email.subject, deputies: recipient.items.map((item) => displayName(item.name)) });
    }
    if (dryRun) {
      continue;
    }
    try {
      await send(config, email);
      markNotified(db, recipient.userId, through);
      run.sent += 1;
    } catch (error) {
      run.failed += 1;
      console.error(`Follow alert to user ${recipient.userId} failed:`, error);
    }
    if (intervalMs) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }
  if (!dryRun && through) {
    // Accounts with nothing new move on too, so a later alert never reports
    // an old speech twice.
    db.prepare(
      `UPDATE follows SET notified_through = ?
       WHERE notified_through < ? AND user_id NOT IN (SELECT user_id FROM user_blocks)
       AND user_id NOT IN (${recipients.map(() => "?").join(",") || "''"})`,
    ).run(through, through, ...recipients.map((recipient) => recipient.userId));
  }
  return run;
}
