import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = path.resolve(SERVER_DIR, "..");

export const FREE_REQUEST_LIMIT_DEFAULT = 10;
export const REGISTER_MAX_PER_HOUR = 5;
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
  emailsPath: string;
  dashboardDataPath: string;
  dashboardDir: string;
  usingDevSecret: boolean;
  secret: string;
  baseURL: string;
  trustedOrigins: string[];
  trustProxy: boolean;
  trustEmail: boolean;
  hasMailer: boolean;
  resendApiKey: string;
  emailFrom: string;
  adminToken: string;
  freeRequestLimit: number;
  allowInsecureHttp: boolean;
};

function readBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") {
    return fallback;
  }
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
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
  const secret = (env.BETTER_AUTH_SECRET || env.AUTH_SECRET || "").trim();
  const baseURL = (env.BETTER_AUTH_URL || env.AUTH_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
  const resendApiKey = (env.RESEND_API_KEY || "").trim();
  const emailFrom = (env.EMAIL_FROM || "").trim();
  const hasMailer = Boolean(resendApiKey && emailFrom);
  const trustEmailExplicit = env.AUTH_TRUST_EMAIL;
  const trustEmail =
    trustEmailExplicit === undefined || trustEmailExplicit === ""
      ? !hasMailer
      : readBoolean(trustEmailExplicit, !hasMailer);
  const allowInsecureHttp = readBoolean(env.ALLOW_INSECURE_HTTP, !isProduction);

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
  }

  mkdirSync(dataDir, { recursive: true, mode: 0o700 });

  return {
    nodeEnv,
    isProduction,
    isTest,
    port: Number(env.PORT || 8000),
    host: env.HOST || "127.0.0.1",
    dataDir,
    sqlitePath: path.join(dataDir, "auth.sqlite"),
    emailsPath: path.join(dataDir, "emails.jsonl"),
    dashboardDataPath,
    dashboardDir,
    usingDevSecret: !secret,
    secret: secret || DEV_SECRET,
    baseURL,
    trustedOrigins: parseOrigins(baseURL, env.AUTH_TRUSTED_ORIGINS),
    trustProxy: readBoolean(env.TRUST_PROXY, false),
    trustEmail,
    hasMailer,
    resendApiKey,
    emailFrom,
    adminToken: (env.ADMIN_TOKEN || "").trim(),
    freeRequestLimit: Math.max(1, Number(env.FREE_REQUEST_LIMIT || FREE_REQUEST_LIMIT_DEFAULT) || FREE_REQUEST_LIMIT_DEFAULT),
    allowInsecureHttp,
  };
}

export function assertSafeHostBinding(config: AppConfig): void {
  if (config.isProduction && config.host === "0.0.0.0" && !config.trustProxy) {
    console.warn("HOST=0.0.0.0 without TRUST_PROXY=1: client IPs will not be taken from X-Forwarded-For.");
  }
}
