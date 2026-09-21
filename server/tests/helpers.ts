import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, type AppConfig } from "../src/config.ts";
import { createApp } from "../src/app.ts";

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const ORIGIN = "http://127.0.0.1:8000";
export const POLITICIANS = Array.from({ length: 12 }, (_, index) => `m-alice-${index}--lfi-nfp`);

export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), "polititia-auth-"));
  return {
    ...loadConfig({
      NODE_ENV: "test",
      BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-32-abcdef",
      BETTER_AUTH_URL: ORIGIN,
      AUTH_TRUST_EMAIL: "1",
      TRUST_PROXY: "1",
      FREE_REQUEST_LIMIT: "10",
      DATA_DIR: dataDir,
      DASHBOARD_DIR: path.join(SERVER_DIR, "..", "dashboard"),
      DASHBOARD_DATA_PATH: path.join(SERVER_DIR, "fixtures", "dashboard-data.json"),
      ADMIN_TOKEN: "admin-test-token",
      HOST: "127.0.0.1",
      PORT: "8000",
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
        this.cookies.set(pair.slice(0, eq), pair.slice(eq + 1));
      }
    }
  }

  header(): string {
    return [...this.cookies.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
  }
}

export async function startTestApp(overrides: Partial<AppConfig> = {}) {
  const config = testConfig(overrides);
  const started = await createApp(config);
  const jar = new CookieJar();

  async function request(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    if (!headers.has("cookie") && jar.header()) {
      headers.set("cookie", jar.header());
    }
    const response = await started.app.request(new Request(`${ORIGIN}${path}`, { ...init, headers }));
    jar.store(response);
    return response;
  }

  return { ...started, config, jar, request };
}
