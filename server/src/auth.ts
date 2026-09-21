import { betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { magicLink } from "better-auth/plugins";
import type { Store } from "./store.ts";
import type { AppConfig } from "./config.ts";
import { captureEmail, isValidEmail, normalizeEmail } from "./emails.ts";

export type PendingMagicLink = {
  email: string;
  token: string;
  url: string;
};

export async function createAuthInstance(
  config: AppConfig,
  db: Store,
  pending: Map<string, PendingMagicLink>,
) {
  const secureCookies = config.baseURL.startsWith("https://");

  const options = {
    appName: "Polititia",
    baseURL: config.baseURL,
    secret: config.secret,
    database: db,
    trustedOrigins: config.trustedOrigins,
    rateLimit: {
      enabled: true,
      window: 60,
      max: 20,
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
      cookieCache: {
        enabled: true,
        maxAge: 60 * 5,
      },
    },
    advanced: {
      useSecureCookies: secureCookies,
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: "lax" as const,
        secure: secureCookies,
        path: "/",
      },
      ipAddress: {
        ipAddressHeaders: config.trustProxy ? ["x-forwarded-for", "x-real-ip", "cf-connecting-ip"] : [],
      },
    },
    emailAndPassword: {
      enabled: false,
    },
    plugins: [
      magicLink({
        expiresIn: 60 * 15,
        storeToken: "hashed" as const,
        disableSignUp: false,
        sendMagicLink: async ({ email, token, url }) => {
          const normalized = normalizeEmail(email);
          if (!isValidEmail(normalized)) {
            return;
          }
          pending.set(normalized, { email: normalized, token, url });
          captureEmail(config.emailsPath, { email: normalized, source: "magic-link" });
          if (config.hasMailer) {
            const response = await fetch("https://api.resend.com/emails", {
              method: "POST",
              headers: {
                Authorization: `Bearer ${config.resendApiKey}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                from: config.emailFrom,
                to: normalized,
                subject: "Votre accès Polititia",
                html: `<p>Cliquez sur ce lien pour continuer à explorer Polititia :</p><p><a href="${url}">Ouvrir Polititia</a></p>`,
              }),
            });
            if (!response.ok) {
              throw new Error("Unable to send magic link email.");
            }
          } else if (!config.isProduction) {
            console.info(`[auth] magic link for ${normalized}: ${url}`);
          }
        },
      }),
    ],
  };

  const { runMigrations } = await getMigrations(options);
  await runMigrations();
  return betterAuth(options);
}

export type AuthInstance = Awaited<ReturnType<typeof createAuthInstance>>;
