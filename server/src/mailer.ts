import type { AppConfig } from "./config.ts";

export type OutgoingEmail = {
  to: string;
  subject: string;
  html: string;
};

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export async function sendEmail(config: AppConfig, email: OutgoingEmail): Promise<void> {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: config.emailFrom, ...email }),
  });
  if (!response.ok) {
    throw new Error(`Resend rejected the email (${response.status}).`);
  }
}

const SIGNUP_DATE_FORMAT = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "full",
  timeStyle: "medium",
  timeZone: "Europe/Paris",
});

export async function notifySignup(
  config: AppConfig,
  signup: { email: string; ip: string; createdAt: Date },
): Promise<void> {
  if (!config.signupNotifyEmail) {
    return;
  }
  if (!config.hasMailer) {
    if (!config.isProduction && !config.isTest) {
      console.info(`[signup] new user ${signup.email} from ${signup.ip}`);
    }
    return;
  }
  const when = SIGNUP_DATE_FORMAT.format(signup.createdAt);
  await sendEmail(config, {
    to: config.signupNotifyEmail,
    subject: `Nouvel utilisateur Polititia : ${signup.email}`,
    html: [
      "<p>Un nouvel utilisateur vient de s'inscrire sur Polititia.</p>",
      "<ul>",
      `<li>Email : ${escapeHtml(signup.email)}</li>`,
      `<li>Adresse IP : ${escapeHtml(signup.ip)}</li>`,
      `<li>Date : ${escapeHtml(when)}</li>`,
      "</ul>",
    ].join(""),
  });
}
