import { betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { magicLink } from "better-auth/plugins";
import type { Store } from "./store.ts";
import type { AppConfig } from "./config.ts";
import { isValidEmail, normalizeEmail } from "./emails.ts";
import { escapeHtml, notifySignup, sendEmail } from "./mailer.ts";
import { CLIENT_IP_HEADER, requestContext } from "./request-context.ts";
import { isBlocked, recordActivity } from "./admin.ts";
import type { GeoLocator } from "./geo.ts";

export type PendingMagicLink = {
  email: string;
  token: string;
  url: string;
};

export function magicLinkEmail(url: string): string {
  const href = escapeHtml(url);
  return [
    "<p>Bonjour,</p>",
    "<p>Pour éviter les usages abusifs (robots, aspiration massive des données), nous vérifions que chaque utilisateur de <strong>La parole des députés</strong> est une personne réelle.</p>",
    `<p><a href="${href}">Confirmer mon adresse et continuer</a></p>`,
    "<p>Ce lien est valable 15 minutes. Votre adresse sert uniquement à cette vérification : aucune lettre d’information, aucune prospection, aucune cession.</p>",
    "<p>Si vous n’êtes pas à l’origine de cette demande, ignorez ce message : rien ne sera conservé.</p>",
  ].join("\n");
}

export async function createAuthInstance(
  config: AppConfig,
  db: Store,
  pending: Map<string, PendingMagicLink>,
  geo: GeoLocator,
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
        ipAddressHeaders: [CLIENT_IP_HEADER],
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
      session: {
        create: {
          // Returning false makes Better Auth refuse the sign-in.
          before: async (session: { userId: string }) => (isBlocked(db, session.userId) ? false : undefined),
          after: async (session: { userId: string }) => {
            const context = requestContext.getStore();
            const location = geo.locate(context?.ip || "", context?.headers);
            try {
              recordActivity(db, session.userId, location, "sign_in");
            } catch (error) {
              console.error("[admin] cannot record the sign-in:", error);
            }
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
          // The address is only stored (as a Better Auth user) once this link is opened.
          if (config.exposeMagicLink) {
            pending.set(normalized, { email: normalized, token, url });
          }
          if (config.hasMailer) {
            await sendEmail(config, {
              to: normalized,
              subject: "Confirmez votre adresse pour La parole des députés",
              html: magicLinkEmail(url),
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
