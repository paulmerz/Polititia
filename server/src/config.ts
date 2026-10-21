import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isValidEmail } from "./emails.ts";

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = path.resolve(SERVER_DIR, "..");

export const FREE_REQUEST_LIMIT_DEFAULT = 10;
export const REGISTER_MAX_PER_HOUR = 5;
export const EMAIL_RESEND_COOLDOWN_SECONDS = 60;
export const EMAIL_MAX_PER_DAY = 5;
// One action sends up to 4 requests (Assembly, theme, person, group).
export const ACCOUNT_REQUESTS_PER_MINUTE_DEFAULT = 120;
export const ACCOUNT_REQUESTS_PER_DAY_DEFAULT = 2000;
export const DEVICE_COOKIE_NAME = "pt_did";
const DEV_SECRET = "polititia-dev-secret-do-not-use-in-production";

export type AppConfig = {
  nodeEnv: string;
  isProduction: boolean;
  isTest: boolean;
  port: number;
  host: string;
  dataDir: string;
  sqlitePath: string;
  // HOST and BETTER_AUTH_URL both point at this machine.
  localOnly: boolean;
  dashboardDataPath: string;
  communesPath: string;
  analyticsPath: string;
  dashboardDir: string;
  usingDevSecret: boolean;
  secret: string;
  baseURL: string;
  trustedOrigins: string[];
  // True when the client address comes from a proxy header (proxyHops or Cloudflare).
  trustProxy: boolean;
  // Number of reverse proxies that append to X-Forwarded-For in front of the server.
  proxyHops: number;
  // Cloudflare is the only way in: CF-Connecting-IP, CF-IPCountry and CF-IPCity are trusted.
  trustCloudflare: boolean;
  hasMailer: boolean;
  // Without a mailer (development on this machine and tests only) the magic
  // link is returned to the browser instead of being emailed.
  exposeMagicLink: boolean;
  resendApiKey: string;
  emailFrom: string;
  turnstileSiteKey: string;
  turnstileSecretKey: string;
  signupNotifyEmail: string;
  // Signed-in accounts allowed on /admin. Empty disables the admin pages.
  adminEmails: string[];
  geoipPath: string;
  freeRequestLimit: number;
  // Ceilings for signed-in accounts (administrators excepted).
  accountRequestsPerMinute: number;
  accountRequestsPerDay: number;
  allowInsecureHttp: boolean;
};

function readPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function readBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") {
    return fallback;
  }
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

// TRUST_PROXY: 0/off (default), 1/on (one proxy), a number of proxies, or "cloudflare".
function parseTrustProxy(value: string | undefined): { proxyHops: number; trustCloudflare: boolean } {
  const trimmed = (value || "").trim().toLowerCase();
  if (trimmed === "cloudflare") {
    return { proxyHops: 0, trustCloudflare: true };
  }
  if (/^\d+$/.test(trimmed)) {
    return { proxyHops: Math.min(Number(trimmed), 10), trustCloudflare: false };
  }
  return { proxyHops: readBoolean(trimmed, false) ? 1 : 0, trustCloudflare: false };
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

// No default recipient: every deployment chooses who receives the users' emails and IPs.
function parseNotifyEmail(value: string | undefined): string {
  const trimmed = (value || "").trim().toLowerCase();
  if (!trimmed || ["0", "false", "no", "off"].includes(trimmed)) {
    return "";
  }
  if (!isValidEmail(trimmed)) {
    throw new Error("SIGNUP_NOTIFY_EMAIL must be an email address, or empty/off to disable the notification.");
  }
  return trimmed;
}

function parseEmailList(value: string | undefined): string[] {
  return [
    ...new Set(
      (value || "")
        .split(",")
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
}

function parseOrigins(baseURL: string, extra: string | undefined): string[] {
  const url = new URL(baseURL);
  const origins = new Set<string>([url.origin]);
  const port = url.port ? `:${url.port}` : "";
  if (url.hostname === "127.0.0.1") {
    origins.add(`${url.protocol}//localhost${port}`);
  }
  if (url.hostname === "localhost") {
    origins.add(`${url.protocol}//127.0.0.1${port}`);
  }
  for (const item of (extra || "").split(",")) {
    const trimmed = item.trim();
    if (trimmed) {
      origins.add(trimmed.replace(/\/$/, ""));
    }
  }
  return [...origins];
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = env.NODE_ENV || "development";
  const isProduction = nodeEnv === "production";
  const isTest = nodeEnv === "test";
  const dataDir = path.resolve(env.DATA_DIR || path.join(SERVER_DIR, "data"));
  const dashboardDir = path.resolve(env.DASHBOARD_DIR || path.join(REPO_ROOT, "dashboard"));
  const dashboardDataPath = path.resolve(
    env.DASHBOARD_DATA_PATH || path.join(dashboardDir, "data", "dashboard-data.json"),
  );
  const communesPath = path.resolve(env.COMMUNES_PATH || path.join(dashboardDir, "data", "communes.json"));
  const secret = (env.BETTER_AUTH_SECRET || env.AUTH_SECRET || "").trim();
  const baseURL = (env.BETTER_AUTH_URL || env.AUTH_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
  const resendApiKey = (env.RESEND_API_KEY || "").trim();
  const emailFrom = (env.EMAIL_FROM || "").trim();
  const hasMailer = Boolean(resendApiKey && emailFrom);
  const turnstileSiteKey = (env.TURNSTILE_SITE_KEY || "").trim();
  const turnstileSecretKey = (env.TURNSTILE_SECRET_KEY || "").trim();
  const analyticsPath = path.resolve(
    env.ANALYTICS_DB_PATH || path.join(REPO_ROOT, "analysis_outputs", "analytics.sqlite"),
  );
  const allowInsecureHttp = readBoolean(env.ALLOW_INSECURE_HTTP, !isProduction);
  const host = env.HOST || "127.0.0.1";
  const localOnly = LOOPBACK_HOSTS.has(host) && LOOPBACK_HOSTS.has(new URL(baseURL).hostname);
  const { proxyHops, trustCloudflare } = parseTrustProxy(env.TRUST_PROXY);

  if (!isProduction && !isTest && !localOnly && !secret) {
    throw new Error(
      "Outside this machine, set NODE_ENV=production and BETTER_AUTH_SECRET: the development secret is public.",
    );
  }
  if (isProduction) {
    if (secret.length < 32) {
      throw new Error("BETTER_AUTH_SECRET must be set to at least 32 characters in production.");
    }
    if (baseURL.startsWith("http://") && !allowInsecureHttp) {
      throw new Error("BETTER_AUTH_URL must use https in production (or set ALLOW_INSECURE_HTTP=1).");
    }
    if (secret === DEV_SECRET) {
      throw new Error("Refusing to start with the development auth secret.");
    }
    if (!hasMailer) {
      throw new Error("RESEND_API_KEY and EMAIL_FROM are required in production: every email is verified.");
    }
  }
  if (Boolean(turnstileSiteKey) !== Boolean(turnstileSecretKey)) {
    throw new Error("Set both TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY, or neither.");
  }

  mkdirSync(dataDir, { recursive: true, mode: 0o700 });

  return {
    nodeEnv,
    isProduction,
    isTest,
    port: Number(env.PORT || 8000),
    host,
    dataDir,
    sqlitePath: path.join(dataDir, "auth.sqlite"),
    localOnly,
    dashboardDataPath,
    communesPath,
    analyticsPath,
    dashboardDir,
    usingDevSecret: !secret,
    secret: secret || DEV_SECRET,
    baseURL,
    trustedOrigins: parseOrigins(baseURL, env.AUTH_TRUSTED_ORIGINS),
    trustProxy: proxyHops > 0 || trustCloudflare,
    proxyHops,
    trustCloudflare,
    hasMailer,
    // Anyone who can reach the server could sign in as anyone, admins included.
    exposeMagicLink: !isProduction && !hasMailer && localOnly,
    resendApiKey,
    emailFrom,
    turnstileSiteKey,
    turnstileSecretKey,
    signupNotifyEmail: parseNotifyEmail(env.SIGNUP_NOTIFY_EMAIL),
    adminEmails: parseEmailList(env.ADMIN_EMAILS),
    geoipPath: path.resolve(env.GEOIP_DB_PATH || path.join(dataDir, "geoip.mmdb")),
    freeRequestLimit: Math.max(1, Number(env.FREE_REQUEST_LIMIT || FREE_REQUEST_LIMIT_DEFAULT) || FREE_REQUEST_LIMIT_DEFAULT),
    accountRequestsPerMinute: readPositiveInt(env.ACCOUNT_REQUESTS_PER_MINUTE, ACCOUNT_REQUESTS_PER_MINUTE_DEFAULT),
    accountRequestsPerDay: readPositiveInt(env.ACCOUNT_REQUESTS_PER_DAY, ACCOUNT_REQUESTS_PER_DAY_DEFAULT),
    allowInsecureHttp,
  };
}

export function assertSafeHostBinding(config: AppConfig): void {
  if (config.isProduction && config.host === "0.0.0.0" && !config.trustProxy) {
    console.warn("HOST=0.0.0.0 without TRUST_PROXY: client IPs are the socket addresses, not X-Forwarded-For.");
  }
}
