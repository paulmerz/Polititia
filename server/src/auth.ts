import { betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { magicLink } from "better-auth/plugins";
import type { Store } from "./store.ts";
import type { AppConfig } from "./config.ts";
import { captureEmail, isValidEmail, normalizeEmail } from "./emails.ts";
import { escapeHtml, notifySignup, sendEmail } from "./mailer.ts";
import { requestContext } from "./request-context.ts";

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
    databaseHooks: {
      user: {
        create: {
          after: async (user: { email: string; createdAt: Date }) => {
            const signup = {
              email: normalizeEmail(user.email),
              ip: requestContext.getStore()?.ip || "inconnue",
              createdAt: new Date(user.createdAt),
            };
            // Detached so a mail provider outage never blocks account creation.
            void notifySignup(config, signup).catch((error) => {
              console.error("[signup] notification failed:", error);
            });
          },
        },
      },
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
            await sendEmail(config, {
              to: normalized,
              subject: "Votre accès Polititia",
              html: `<p>Cliquez sur ce lien pour continuer à explorer Polititia :</p><p><a href="${escapeHtml(url)}">Ouvrir Polititia</a></p>`,
            });
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
