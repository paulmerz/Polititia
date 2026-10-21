import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, type AppConfig } from "../src/config.ts";
import { createApp } from "../src/app.ts";
import { ALICES, buildAnalyticsFixture } from "./analytics-fixture.ts";

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const ORIGIN = "http://127.0.0.1:8000";
export const POLITICIANS = ALICES;

let analyticsPath: string | null = null;

export function analyticsFixturePath(): string {
  analyticsPath ||= buildAnalyticsFixture();
  return analyticsPath;
}

export function testConfig(overrides: Partial<AppConfig> = {}, env: Record<string, string> = {}): AppConfig {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), "polititia-auth-"));
  return {
    ...loadConfig({
      NODE_ENV: "test",
      BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-32-abcdef",
      BETTER_AUTH_URL: ORIGIN,
      TRUST_PROXY: "1",
      FREE_REQUEST_LIMIT: "10",
      DATA_DIR: dataDir,
      DASHBOARD_DIR: path.join(SERVER_DIR, "..", "dashboard"),
      DASHBOARD_DATA_PATH: path.join(SERVER_DIR, "fixtures", "dashboard-data.json"),
      COMMUNES_PATH: path.join(SERVER_DIR, "fixtures", "communes.json"),
      ANALYTICS_DB_PATH: analyticsFixturePath(),
      HOST: "127.0.0.1",
      PORT: "8000",
      ...env,
    }),
    ...overrides,
  };
}

export class CookieJar {
  cookies = new Map<string, string>();

  store(response: Response): void {
    const setCookies =
      typeof response.headers.getSetCookie === "function"
        ? response.headers.getSetCookie()
        : response.headers.get("set-cookie")
          ? [response.headers.get("set-cookie") as string]
          : [];
    for (const raw of setCookies) {
      const pair = raw.split(";", 1)[0];
      const eq = pair.indexOf("=");
      if (eq > 0) {
        const name = pair.slice(0, eq);
        const value = pair.slice(eq + 1);
        if (!value || /max-age=0/i.test(raw)) {
          this.cookies.delete(name);
        } else {
          this.cookies.set(name, value);
        }
      }
    }
  }

  header(): string {
    return [...this.cookies.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
  }
}

export async function startTestApp(overrides: Partial<AppConfig> = {}, env: Record<string, string> = {}) {
  const config = testConfig(overrides, env);
  const started = await createApp(config);

  // One browser: its own cookies, headers sent with every request (for
  // instance the address a trusted proxy forwards) and its socket address.
  function client(defaultHeaders: Record<string, string> = {}, socketIp?: string) {
    const env = socketIp ? { incoming: { socket: { remoteAddress: socketIp } } } : undefined;
    const jar = new CookieJar();

    async function request(path: string, init: RequestInit = {}) {
      const headers = new Headers(init.headers);
      for (const [name, value] of Object.entries(defaultHeaders)) {
        if (!headers.has(name)) {
          headers.set(name, value);
        }
      }
      if (!headers.has("cookie") && jar.header()) {
        headers.set("cookie", jar.header());
      }
      const response = await started.app.request(new Request(`${ORIGIN}${path}`, { ...init, headers }), undefined, env);
      jar.store(response);
      return response;
    }

    async function register(email: string, extra: Record<string, unknown> = {}) {
      return request("/api/register", {
        method: "POST",
        headers: { origin: ORIGIN, "content-type": "application/json" },
        body: JSON.stringify({ email, ...extra }),
      });
    }

    // Follows the emailed link the way a browser would.
    async function verify(link: string) {
      const url = new URL(link);
      return request(`${url.pathname}${url.search}`, { redirect: "manual" });
    }

    async function signIn(email: string) {
      const payload = await (await register(email)).json();
      if (!payload.devLink) {
        throw new Error(`No magic link for ${email}: ${JSON.stringify(payload)}`);
      }
      const response = await verify(payload.devLink);
      const location = response.headers.get("location") || "";
      if (response.status !== 302 || location.includes("error=")) {
        throw new Error(`Sign-in failed for ${email}: ${response.status} ${location}`);
      }
      return response;
    }

    return { jar, request, register, verify, signIn };
  }

  return { ...started, config, ...client(), client };
}
