import { existsSync, readFileSync } from "node:fs";
import { timingSafeEqual } from "node:crypto";
import path from "node:path";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { secureHeaders } from "hono/secure-headers";
import type { AppConfig } from "./config.ts";
import { DEVICE_COOKIE_NAME } from "./config.ts";
import { createAuthInstance, type AuthInstance, type PendingMagicLink } from "./auth.ts";
import { bootstrapPayload, loadDashboardData, politicianPhrases } from "./data.ts";
import { isValidEmail, normalizeEmail } from "./emails.ts";
import {
  clientIp,
  consumeQuota,
  createDeviceId,
  deviceCookieHeader,
  parseDeviceCookie,
  readQuota,
  registerRateLimited,
  unlimitedQuota,
} from "./quota.ts";
import { openStore } from "./store.ts";

type SessionUser = { email?: string | null } | null;

const STATIC_FILES: Record<string, string> = {
  "/": "index.html",
  "/index.html": "index.html",
  "/app.js": "app.js",
  "/styles.css": "styles.css",
  "/quota-gate.js": "quota-gate.js",
};

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

function originAllowed(config: AppConfig, origin: string | undefined): boolean {
  return Boolean(origin && config.trustedOrigins.includes(origin));
}

function sameOriginOrSafeGet(config: AppConfig, request: Request): boolean {
  const origin = request.headers.get("origin");
  if (origin) {
    return originAllowed(config, origin);
  }
  return request.method === "GET" || request.method === "HEAD";
}

function deviceFromRequest(config: AppConfig, request: Request): { deviceId: string; isNew: boolean } {
  const raw = request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${DEVICE_COOKIE_NAME}=`))
    ?.slice(DEVICE_COOKIE_NAME.length + 1);
  const parsed = parseDeviceCookie(config.secret, raw);
  if (parsed) {
    return { deviceId: parsed, isNew: false };
  }
  return { deviceId: createDeviceId(), isNew: true };
}

function applyDeviceCookie(config: AppConfig, response: Response, deviceId: string): Response {
  const secure = config.baseURL.startsWith("https://");
  response.headers.append("Set-Cookie", deviceCookieHeader(config.secret, deviceId, secure));
  return response;
}

async function currentSession(
  auth: AuthInstance,
  request: Request,
): Promise<{ user: SessionUser } | null> {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    return session ? { user: session.user } : null;
  } catch {
    return null;
  }
}

function bearerMatches(token: string, expected: string): boolean {
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

export async function createApp(config: AppConfig) {
  const db = openStore(config.sqlitePath);
  const pending = new Map<string, PendingMagicLink>();
  const auth = await createAuthInstance(config, db, pending);

  const app = new Hono();

  app.use(
    "*",
    secureHeaders({
      xFrameOptions: "DENY",
      xContentTypeOptions: "nosniff",
      referrerPolicy: "strict-origin-when-cross-origin",
      strictTransportSecurity: config.baseURL.startsWith("https://")
        ? "max-age=15552000; includeSubDomains"
        : false,
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    }),
  );

  app.use(
    "/api/*",
    bodyLimit({
      maxSize: 16 * 1024,
      onError: (c) => c.json({ error: "payload_too_large" }, 413),
    }),
  );

  app.use("*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    if (config.baseURL.startsWith("https://")) {
      c.header("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
    }
    await next();
    c.res.headers.delete("x-powered-by");
  });

  app.onError((error, c) => {
    console.error(error);
    return c.json({ error: "internal" }, 500);
  });

  app.all("/api/auth/*", (c) => {
    if (!sameOriginOrSafeGet(config, c.req.raw) && c.req.method !== "OPTIONS") {
      return c.json({ error: "forbidden" }, 403);
    }
    return auth.handler(c.req.raw);
  });

  app.get("/api/health", (c) => c.json({ ok: true }));

  app.get("/api/bootstrap", async (c) => {
    if (!existsSync(config.dashboardDataPath)) {
      return c.json({ error: "dashboard_data_missing" }, 503);
    }
    const { deviceId } = deviceFromRequest(config, c.req.raw);
    const ip = clientIp(c.req.raw.headers, config.trustProxy);
    const session = await currentSession(auth, c.req.raw);
    const data = loadDashboardData(config.dashboardDataPath);
    const quota = session?.user
      ? unlimitedQuota
      : readQuota(db, config.secret, ip, deviceId, config.freeRequestLimit);
    const body = {
      ...bootstrapPayload(data),
      quota,
      session: session?.user?.email ? { email: session.user.email } : null,
      auth: { trustEmail: config.trustEmail, hasMailer: config.hasMailer },
    };
    return applyDeviceCookie(config, c.json(body), deviceId);
  });

  app.get("/api/quota", async (c) => {
    const { deviceId } = deviceFromRequest(config, c.req.raw);
    const ip = clientIp(c.req.raw.headers, config.trustProxy);
    const session = await currentSession(auth, c.req.raw);
    const quota = session?.user
      ? unlimitedQuota
      : readQuota(db, config.secret, ip, deviceId, config.freeRequestLimit);
    return applyDeviceCookie(
      config,
      c.json({
        quota,
        session: session?.user?.email ? { email: session.user.email } : null,
      }),
      deviceId,
    );
  });

  app.get("/api/politician/:id", async (c) => {
    if (!sameOriginOrSafeGet(config, c.req.raw)) {
      return c.json({ error: "forbidden" }, 403);
    }
    if (!existsSync(config.dashboardDataPath)) {
      return c.json({ error: "dashboard_data_missing" }, 503);
    }
    const { deviceId } = deviceFromRequest(config, c.req.raw);
    const ip = clientIp(c.req.raw.headers, config.trustProxy);
    const session = await currentSession(auth, c.req.raw);
    const data = loadDashboardData(config.dashboardDataPath);
    const phrases = politicianPhrases(data, c.req.param("id"));
    if (!phrases) {
      return applyDeviceCookie(config, c.json({ error: "not_found" }, 404), deviceId);
    }

    if (!session?.user) {
      const quota = consumeQuota(db, config.secret, ip, deviceId, config.freeRequestLimit);
      if (!quota.allowed) {
        return applyDeviceCookie(
          config,
          c.json(
            {
              error: "quota_exceeded",
              quota: { limit: quota.limit, used: quota.used, remaining: 0, unlimited: false },
            },
            429,
          ),
          deviceId,
        );
      }
      return applyDeviceCookie(
        config,
        c.json({
          id: c.req.param("id"),
          phrases,
          quota,
        }),
        deviceId,
      );
    }

    return applyDeviceCookie(
      config,
      c.json({
        id: c.req.param("id"),
        phrases,
        quota: unlimitedQuota,
      }),
      deviceId,
    );
  });

  app.post("/api/register", async (c) => {
    if (!originAllowed(config, c.req.header("origin"))) {
      return c.json({ error: "forbidden" }, 403);
    }
    const { deviceId } = deviceFromRequest(config, c.req.raw);
    const ip = clientIp(c.req.raw.headers, config.trustProxy);
    if (registerRateLimited(db, config.secret, ip)) {
      return applyDeviceCookie(config, c.json({ error: "rate_limited" }, 429), deviceId);
    }

    let body: { email?: string };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }
    const email = normalizeEmail(String(body.email || ""));
    if (!isValidEmail(email)) {
      return c.json({ error: "invalid_email" }, 400);
    }

    await auth.api.signInMagicLink({
      body: {
        email,
        name: email.split("@")[0],
        callbackURL: "/",
      },
      headers: c.req.raw.headers,
    });

    if (!config.trustEmail) {
      if (!config.hasMailer) {
        return c.json({ error: "mailer_unconfigured" }, 503);
      }
      return applyDeviceCookie(config, c.json({ ok: true, checkEmail: true }), deviceId);
    }

    const magic = pending.get(email);
    pending.delete(email);
    if (!magic?.token) {
      return c.json({ error: "auth_failed" }, 400);
    }

    const verified = await auth.api.magicLinkVerify({
      query: { token: magic.token },
      headers: c.req.raw.headers,
      asResponse: true,
    });

    const response = new Response(JSON.stringify({ ok: true, checkEmail: false, session: true }), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
    const setCookies =
      typeof verified.headers.getSetCookie === "function"
        ? verified.headers.getSetCookie()
        : verified.headers.get("set-cookie")
          ? [verified.headers.get("set-cookie") as string]
          : [];
    for (const cookie of setCookies) {
      response.headers.append("Set-Cookie", cookie);
    }
    return applyDeviceCookie(config, response, deviceId);
  });

  app.get("/api/admin/emails", async (c) => {
    if (!config.adminToken) {
      return c.json({ error: "not_found" }, 404);
    }
    const header = c.req.header("authorization") || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token || !bearerMatches(token, config.adminToken)) {
      return c.json({ error: "unauthorized" }, 401);
    }
    if (!existsSync(config.emailsPath)) {
      return c.json({ emails: [] });
    }
    const lines = readFileSync(config.emailsPath, "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { email: string; createdAt: string; source: string });
    const emails = [...new Map(lines.map((row) => [row.email, row])).values()];
    return c.json({ emails });
  });

  for (const [urlPath, relative] of Object.entries(STATIC_FILES)) {
    app.get(urlPath, (c) => {
      const absolute = path.resolve(config.dashboardDir, relative);
      if (!absolute.startsWith(path.resolve(config.dashboardDir) + path.sep) && absolute !== path.resolve(config.dashboardDir, relative)) {
        return c.json({ error: "not_found" }, 404);
      }
      if (!existsSync(absolute)) {
        return c.json({ error: "not_found" }, 404);
      }
      const ext = path.extname(absolute);
      return new Response(readFileSync(absolute), {
        headers: {
          "Content-Type": CONTENT_TYPES[ext] || "application/octet-stream",
          "Cache-Control": ext === ".html" ? "no-store" : "public, max-age=300",
          "X-Content-Type-Options": "nosniff",
        },
      });
    });
  }

  app.notFound((c) => c.json({ error: "not_found" }, 404));

  return { app, db, auth, pending };
}
