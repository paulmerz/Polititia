import { existsSync, readFileSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import path from "node:path";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { secureHeaders } from "hono/secure-headers";
import type { AppConfig } from "./config.ts";
import { DEVICE_COOKIE_NAME, EMAIL_RESEND_COOLDOWN_SECONDS } from "./config.ts";
import { Analytics, openAnalytics, PeriodError, type Period } from "./analytics.ts";
import { createAuthInstance, type AuthInstance, type PendingMagicLink } from "./auth.ts";
import { bootstrapPayload, loadDashboardData, politicianMarkers } from "./data.ts";
import { isDisposableEmail, isValidEmail, normalizeEmail } from "./emails.ts";
import {
  clientIp,
  consumeInteraction,
  createDeviceId,
  deviceCookieHeader,
  emailCooldownSeconds,
  parseDeviceCookie,
  readQuota,
  recordEmailSend,
  registerRateLimited,
  reserveEmail,
  unlimitedQuota,
} from "./quota.ts";
import { openStore, purgeStale, type Store } from "./store.ts";
import { requestContext } from "./request-context.ts";
import {
  adminOverview,
  blockUser,
  findUser,
  isBlocked,
  isBlockedEmail,
  recordActivity,
  unblockUser,
} from "./admin.ts";
import { createGeoLocator } from "./geo.ts";

type SessionUser = { id?: string; email?: string | null } | null;
type NodeBindings = { incoming?: IncomingMessage };

const STATIC_FILES: Record<string, string> = {
  "/": "index.html",
  "/index.html": "index.html",
  "/conditions": "conditions.html",
  "/methode": "methode.html",
  "/app.js": "app.js",
  "/pages.js": "pages.js",
  "/styles.css": "styles.css",
  "/quota-gate.js": "quota-gate.js",
  "/admin": "admin.html",
  "/admin.js": "admin.js",
};

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";
const RETURN_TO_PATTERN = /^\?[A-Za-z0-9=&_.%-]{1,400}$/;
const ADMIN_RETURN_TO = "/admin";
const PURGE_INTERVAL_MS = 60 * 60 * 1000;

// Only what the pages use. Links are requested through /api/register, which
// applies the captcha, the disposable-domain list and the sending limits that
// Better Auth's own /sign-in/magic-link endpoint would skip.
const PUBLIC_AUTH_ROUTES = new Set(["GET /api/auth/magic-link/verify", "POST /api/auth/sign-out"]);

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

function setCookiesOf(response: Response): string[] {
  if (typeof response.headers.getSetCookie === "function") {
    return response.headers.getSetCookie();
  }
  const single = response.headers.get("set-cookie");
  return single ? [single] : [];
}

// A blocked account is treated as signed out, even while its session cookie
// cache is still valid.
async function currentSession(
  auth: AuthInstance,
  db: Store,
  request: Request,
): Promise<{ user: SessionUser } | null> {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session || isBlocked(db, session.user?.id)) {
      return null;
    }
    return { user: session.user };
  } catch {
    return null;
  }
}

async function verifyTurnstile(config: AppConfig, token: string, ip: string): Promise<boolean> {
  if (!config.turnstileSecretKey) {
    return true;
  }
  if (!token) {
    return false;
  }
  try {
    const response = await fetch(`${TURNSTILE_ORIGIN}/turnstile/v0/siteverify`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret: config.turnstileSecretKey, response: token, remoteip: ip }),
    });
    const payload = (await response.json()) as { success?: boolean };
    return Boolean(payload.success);
  } catch {
    return false;
  }
}

type MeteredView = (analytics: Analytics, period: Period, c: Context) => Record<string, unknown> | null;

export async function createApp(config: AppConfig) {
  const db = openStore(config.sqlitePath);
  const pending = new Map<string, PendingMagicLink>();
  const geo = createGeoLocator(config);
  const auth = await createAuthInstance(config, db, pending, geo);
  purgeStale(db);
  if (!config.isTest) {
    setInterval(() => purgeStale(db), PURGE_INTERVAL_MS).unref();
  }

  const app = new Hono<{ Bindings: NodeBindings }>();
  const turnstile = config.turnstileSiteKey ? [TURNSTILE_ORIGIN] : [];

  app.use("*", (c, next) => {
    const socketIp = c.env?.incoming?.socket?.remoteAddress || "inconnue";
    const ip = clientIp(c.req.raw.headers, config.trustProxy, socketIp);
    return requestContext.run({ ip, headers: c.req.raw.headers }, next);
  });

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
        scriptSrc: ["'self'", ...turnstile],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'", ...turnstile],
        frameSrc: turnstile.length ? turnstile : ["'none'"],
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
    if (!PUBLIC_AUTH_ROUTES.has(`${c.req.method} ${c.req.path}`)) {
      return c.json({ error: "not_found" }, 404);
    }
    if (!sameOriginOrSafeGet(config, c.req.raw)) {
      return c.json({ error: "forbidden" }, 403);
    }
    return auth.handler(c.req.raw);
  });

  app.get("/api/health", (c) => c.json({ ok: true }));

  function authInfo() {
    return {
      verification: true,
      exposeMagicLink: config.exposeMagicLink,
      turnstileSiteKey: config.turnstileSiteKey || null,
      resendCooldown: EMAIL_RESEND_COOLDOWN_SECONDS,
    };
  }

  // The first screen never consumes an analysis.
  app.get("/api/bootstrap", async (c) => {
    if (!existsSync(config.dashboardDataPath)) {
      return c.json({ error: "dashboard_data_missing" }, 503);
    }
    const { deviceId } = deviceFromRequest(config, c.req.raw);
    const ip = clientIp(c.req.raw.headers, config.trustProxy);
    const session = await currentSession(auth, db, c.req.raw);
    const data = loadDashboardData(config.dashboardDataPath);
    const analytics = openAnalytics(config.analyticsPath);
    const quota = session?.user
      ? unlimitedQuota
      : readQuota(db, config.secret, ip, deviceId, config.freeRequestLimit);
    const body = {
      ...bootstrapPayload(data),
      analytics: analytics
        ? {
            firstDate: analytics.meta.firstDate,
            lastDate: analytics.meta.lastDate,
            months: analytics.meta.months,
            sessions: analytics.meta.sessions,
            themes: analytics.meta.themes,
          }
        : null,
      quota,
      session: session?.user?.email ? { email: session.user.email } : null,
      auth: authInfo(),
    };
    return applyDeviceCookie(config, c.json(body), deviceId);
  });

  app.get("/api/quota", async (c) => {
    const { deviceId } = deviceFromRequest(config, c.req.raw);
    const ip = clientIp(c.req.raw.headers, config.trustProxy);
    const session = await currentSession(auth, db, c.req.raw);
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

  // Every analysis (a person, a group, a theme or the Assembly, for a period)
  // goes through here and is counted for anonymous visitors.
  async function metered(c: Context, kind: string, id: string, view: MeteredView) {
    if (!sameOriginOrSafeGet(config, c.req.raw)) {
      return c.json({ error: "forbidden" }, 403);
    }
    const { deviceId } = deviceFromRequest(config, c.req.raw);
    const analytics = openAnalytics(config.analyticsPath);
    if (!analytics) {
      return applyDeviceCookie(config, c.json({ error: "analytics_missing" }, 503), deviceId);
    }
    if (id && !analytics.isValidId(id)) {
      return applyDeviceCookie(config, c.json({ error: "not_found" }, 404), deviceId);
    }
    let period: Period;
    try {
      period = analytics.period(c.req.query("from"), c.req.query("to"));
    } catch (error) {
      if (error instanceof PeriodError) {
        return applyDeviceCookie(config, c.json({ error: error.message }, 400), deviceId);
      }
      throw error;
    }
    const session = await currentSession(auth, db, c.req.raw);
    let quota: unknown = unlimitedQuota;
    if (session?.user?.id) {
      const ip = requestContext.getStore()?.ip || "";
      recordActivity(db, session.user.id, geo.locate(ip, c.req.raw.headers), "request");
    } else {
      const ip = clientIp(c.req.raw.headers, config.trustProxy);
      const theme = c.req.query("theme") || "";
      const result = consumeInteraction(db, config.secret, ip, deviceId, config.freeRequestLimit, {
        interactionId: c.req.header("x-interaction-id"),
        view: [kind, id, theme, period.from, period.to].join(":"),
      });
      const { allowed: _allowed, counted: _counted, ...view } = result;
      if (!result.allowed) {
        return applyDeviceCookie(config, c.json({ error: "quota_exceeded", quota: view }, 429), deviceId);
      }
      quota = view;
    }
    const payload = view(analytics, period, c);
    if (!payload) {
      return applyDeviceCookie(config, c.json({ error: "not_found" }, 404), deviceId);
    }
    return applyDeviceCookie(config, c.json({ ...payload, quota }), deviceId);
  }

  app.get("/api/politician/:id", (c) =>
    metered(c, "politician", c.req.param("id"), (analytics, period) => {
      const payload = analytics.politician(c.req.param("id"), period, c.req.query("theme") || "");
      if (!payload) {
        return null;
      }
      const markers = existsSync(config.dashboardDataPath)
        ? politicianMarkers(loadDashboardData(config.dashboardDataPath), payload.id)
        : null;
      return { ...payload, markers };
    }),
  );

  app.get("/api/party/:id", (c) =>
    metered(c, "party", c.req.param("id"), (analytics, period) => analytics.party(c.req.param("id"), period)),
  );

  app.get("/api/theme/:id", (c) =>
    metered(c, "theme", c.req.param("id"), (analytics, period) => analytics.theme(c.req.param("id"), period)),
  );

  app.get("/api/assembly", (c) => metered(c, "assembly", "", (analytics, period) => analytics.assembly(period)));

  let budgetWarnedAt = 0;
  app.post("/api/register", async (c) => {
    if (!originAllowed(config, c.req.header("origin"))) {
      return c.json({ error: "forbidden" }, 403);
    }
    const { deviceId } = deviceFromRequest(config, c.req.raw);
    const ip = clientIp(c.req.raw.headers, config.trustProxy);
    if (registerRateLimited(db, config.secret, ip)) {
      return applyDeviceCookie(config, c.json({ error: "rate_limited" }, 429), deviceId);
    }

    let body: { email?: string; website?: string; turnstileToken?: string; returnTo?: string };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }
    const checkEmail = { ok: true, checkEmail: true, resendIn: EMAIL_RESEND_COOLDOWN_SECONDS };
    // Honeypot: people never see this field, form-filling robots do.
    if (String(body.website || "").trim()) {
      return applyDeviceCookie(config, c.json(checkEmail), deviceId);
    }
    const email = normalizeEmail(String(body.email || ""));
    if (!isValidEmail(email)) {
      return c.json({ error: "invalid_email" }, 400);
    }
    if (isDisposableEmail(email)) {
      return c.json({ error: "disposable_email" }, 400);
    }
    if (isBlockedEmail(db, email)) {
      return applyDeviceCookie(config, c.json({ error: "account_blocked" }, 403), deviceId);
    }
    if (!(await verifyTurnstile(config, String(body.turnstileToken || ""), ip))) {
      return c.json({ error: "captcha_failed" }, 400);
    }
    const wait = emailCooldownSeconds(db, config.secret, email, EMAIL_RESEND_COOLDOWN_SECONDS);
    if (wait > 0) {
      return applyDeviceCookie(config, c.json({ error: "resend_cooldown", retryAfter: wait }, 429), deviceId);
    }

    const budget = reserveEmail(db, config.secret, email, config.emailDailyLimit);
    if (budget === "address_limit") {
      return applyDeviceCookie(config, c.json({ error: "address_limit" }, 429), deviceId);
    }
    if (budget === "daily_limit") {
      if (Date.now() - budgetWarnedAt > PURGE_INTERVAL_MS) {
        budgetWarnedAt = Date.now();
        console.warn(`[register] EMAIL_DAILY_LIMIT (${config.emailDailyLimit}) reached: no link is sent until it frees up.`);
      }
      return applyDeviceCookie(config, c.json({ error: "daily_limit" }, 503), deviceId);
    }

    // Only a query string of the dashboard is accepted, so the link can never
    // send the visitor to another path or origin.
    const returnTo = String(body.returnTo || "");
    const query = RETURN_TO_PATTERN.test(returnTo) ? returnTo.slice(1) : "";
    const callbackURL = returnTo === ADMIN_RETURN_TO ? ADMIN_RETURN_TO : `/?${query ? `${query}&` : ""}verifie=1`;
    await auth.api.signInMagicLink({
      body: { email, name: email.split("@")[0], callbackURL },
      headers: c.req.raw.headers,
    });
    recordEmailSend(db, config.secret, email);
    const magic = pending.get(email);
    pending.delete(email);
    return applyDeviceCookie(
      config,
      c.json({ ...checkEmail, ...(config.exposeMagicLink && magic ? { devLink: magic.url } : {}) }),
      deviceId,
    );
  });

  app.post("/api/account/delete", async (c) => {
    if (!originAllowed(config, c.req.header("origin"))) {
      return c.json({ error: "forbidden" }, 403);
    }
    const session = await currentSession(auth, db, c.req.raw);
    const user = session?.user;
    if (!user?.id) {
      return c.json({ error: "not_signed_in" }, 401);
    }
    const signedOut = await auth.api.signOut({ headers: c.req.raw.headers, asResponse: true });
    db.prepare(`DELETE FROM "user" WHERE id = ?`).run(user.id);
    if (user.email) {
      db.prepare(`DELETE FROM verification WHERE value LIKE ?`).run(`%${JSON.stringify(user.email).slice(1, -1)}%`);
    }
    const response = c.json({ ok: true, deleted: true });
    for (const cookie of setCookiesOf(signedOut)) {
      response.headers.append("Set-Cookie", cookie);
    }
    return response;
  });

  const adminEmails = new Set(config.adminEmails);
  type AdminCheck = { admin: { id: string; email: string } } | { response: Response };

  // Without ADMIN_EMAILS the admin pages do not exist.
  async function requireAdmin(c: Context, write: boolean): Promise<AdminCheck> {
    if (!adminEmails.size) {
      return { response: c.json({ error: "not_found" }, 404) };
    }
    const sameOrigin = write ? originAllowed(config, c.req.header("origin")) : sameOriginOrSafeGet(config, c.req.raw);
    if (!sameOrigin) {
      return { response: c.json({ error: "forbidden" }, 403) };
    }
    const user = (await currentSession(auth, db, c.req.raw))?.user;
    if (!user?.id || !user.email) {
      return { response: c.json({ error: "not_signed_in", auth: authInfo() }, 401) };
    }
    const email = normalizeEmail(user.email);
    if (!adminEmails.has(email)) {
      return { response: c.json({ error: "not_admin", session: { email } }, 403) };
    }
    return { admin: { id: user.id, email } };
  }

  for (const adminPath of ["/admin", "/admin.js"]) {
    app.use(adminPath, async (c, next) => {
      if (!adminEmails.size) {
        return c.json({ error: "not_found" }, 404);
      }
      await next();
      c.res.headers.set("X-Robots-Tag", "noindex, nofollow");
    });
  }

  app.get("/api/admin/overview", async (c) => {
    const check = await requireAdmin(c, false);
    if ("response" in check) {
      return check.response;
    }
    return c.json({
      ...adminOverview(db, config.adminEmails),
      me: { email: check.admin.email },
      geoSource: geo.source(),
    });
  });

  app.post("/api/admin/users/:id/:action{block|unblock}", async (c) => {
    const check = await requireAdmin(c, true);
    if ("response" in check) {
      return check.response;
    }
    const target = findUser(db, c.req.param("id"));
    if (!target) {
      return c.json({ error: "not_found" }, 404);
    }
    if (c.req.param("action") === "unblock") {
      unblockUser(db, target.id);
      return c.json({ ok: true, id: target.id, blocked: false });
    }
    if (adminEmails.has(normalizeEmail(target.email))) {
      return c.json({ error: "cannot_block_admin" }, 400);
    }
    blockUser(db, target.id, check.admin.email);
    return c.json({ ok: true, id: target.id, blocked: true });
  });

  for (const [urlPath, relative] of Object.entries(STATIC_FILES)) {
    app.get(urlPath, (c) => {
      const absolute = path.resolve(config.dashboardDir, relative);
      if (!absolute.startsWith(path.resolve(config.dashboardDir) + path.sep)) {
        return c.json({ error: "not_found" }, 404);
      }
      if (!existsSync(absolute)) {
        return c.json({ error: "not_found" }, 404);
      }
      const ext = path.extname(absolute);
      return new Response(readFileSync(absolute), {
        headers: {
          "Content-Type": CONTENT_TYPES[ext] || "application/octet-stream",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    });
  }

  app.notFound((c) => c.json({ error: "not_found" }, 404));

  return { app, db, auth, pending };
}
