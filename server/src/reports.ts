import type { AppConfig } from "./config.ts";
import { escapeHtml, sendEmail } from "./mailer.ts";
import { isValidEmail, normalizeEmail } from "./emails.ts";
import type { Store } from "./store.ts";

// « Signaler une erreur »: anyone can report, signed in or not, so that a
// deputy's staff can do it in one click. The admins are emailed each report
// and close it from /admin; the public commitment is an answer within 48 h.

export const REPORT_MIN_LENGTH = 10;
export const REPORT_MAX_LENGTH = 2000;
export const REPORTS_PER_HOUR = 5;
const SUBJECT = /^(depute|groupe|theme|assemblee|style|accueil)(:[A-Za-z0-9_.-]{1,80})?$/;
const PAGE = /^\?[A-Za-z0-9=&_.%+-]{1,400}$/;
const DONE_SHOWN = 20;

export type ReportInput = { subject: string; page: string; message: string; email: string | null };
export type Report = ReportInput & { id: number; createdAt: string; status: "open" | "done"; handledAt: string | null; handledBy: string | null };

export function parseReport(body: Record<string, unknown>): ReportInput | { error: string } {
  const subject = String(body.subject || "accueil");
  const rawPage = String(body.page || "");
  const page = PAGE.test(rawPage) ? rawPage : "";
  const message = String(body.message || "").trim();
  const rawEmail = String(body.email || "").trim();
  if (!SUBJECT.test(subject)) {
    return { error: "invalid_subject" };
  }
  if (message.length < REPORT_MIN_LENGTH || message.length > REPORT_MAX_LENGTH) {
    return { error: "invalid_message" };
  }
  if (rawEmail && !isValidEmail(rawEmail)) {
    return { error: "invalid_email" };
  }
  return { subject, page, message, email: rawEmail ? normalizeEmail(rawEmail) : null };
}

export function createReport(db: Store, report: ReportInput, now = Date.now()): number {
  const result = db
    .prepare("INSERT INTO error_reports (created_at, subject, page, message, email, status) VALUES (?, ?, ?, ?, ?, 'open')")
    .run(new Date(now).toISOString(), report.subject, report.page, report.message, report.email);
  return Number(result.lastInsertRowid);
}

function toReport(row: Record<string, unknown>): Report {
  return {
    id: Number(row.id),
    createdAt: String(row.created_at),
    subject: String(row.subject),
    page: String(row.page),
    message: String(row.message),
    email: row.email ? String(row.email) : null,
    status: row.status === "done" ? "done" : "open",
    handledAt: row.handled_at ? String(row.handled_at) : null,
    handledBy: row.handled_by ? String(row.handled_by) : null,
  };
}

export function listReports(db: Store): { open: Report[]; done: Report[] } {
  const open = db.prepare("SELECT * FROM error_reports WHERE status = 'open' ORDER BY created_at").all() as Array<Record<string, unknown>>;
  const done = db
    .prepare("SELECT * FROM error_reports WHERE status = 'done' ORDER BY handled_at DESC LIMIT ?")
    .all(DONE_SHOWN) as Array<Record<string, unknown>>;
  return { open: open.map(toReport), done: done.map(toReport) };
}

export function closeReport(db: Store, id: number, by: string, now = Date.now()): boolean {
  const result = db
    .prepare("UPDATE error_reports SET status = 'done', handled_at = ?, handled_by = ? WHERE id = ? AND status = 'open'")
    .run(new Date(now).toISOString(), by, id);
  return Number(result.changes) > 0;
}

export async function notifyReport(config: AppConfig, report: ReportInput & { id: number }, label: string): Promise<void> {
  if (!config.hasMailer || !config.adminEmails.length) {
    return;
  }
  const link = `${config.baseURL}/${report.page}`;
  const lines = [
    `<p>Signalement n° ${report.id} sur <strong>${escapeHtml(label)}</strong>.</p>`,
    `<blockquote>${escapeHtml(report.message).replaceAll("\n", "<br />")}</blockquote>`,
    `<p>Page : <a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p>`,
    `<p>${report.email ? `Répondre à : ${escapeHtml(report.email)}` : "Pas d'adresse laissée."}</p>`,
    `<p>À clôturer dans <a href="${escapeHtml(config.baseURL)}/admin">l'administration</a> une fois traité (engagement : 48 h).</p>`,
  ];
  for (const to of config.adminEmails) {
    await sendEmail(config, {
      to,
      subject: `Signalement d'erreur : ${label}`,
      html: lines.join(""),
      ...(report.email ? { headers: { "Reply-To": report.email } } : {}),
    });
  }
}
