import { existsSync, readFileSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import path from "node:path";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { secureHeaders } from "hono/secure-headers";
import type { AppConfig } from "./config.ts";
import { DEVICE_COOKIE_NAME, EMAIL_MAX_PER_DAY, EMAIL_RESEND_COOLDOWN_SECONDS } from "./config.ts";
import { Analytics, openAnalytics, PeriodError, type Period } from "./analytics.ts";
import { createAuthInstance, type AuthInstance, type PendingMagicLink } from "./auth.ts";
import { loadCommunes, searchCommunes } from "./communes.ts";
import { bootstrapPayload, loadDashboardData, politicianMarkers, type DashboardBundle } from "./data.ts";
import { isDisposableEmail, isValidEmail, normalizeEmail } from "./emails.ts";
import {
  accountRateLimited,
  clientIp,
  consumeInteraction,
  createDeviceId,
  describeClientIp,
  deviceCookieHeader,
  emailCooldownSeconds,
  emailDailyLimitSeconds,
  ipRateLimited,
  parseDeviceCookie,
  readQuota,
  recordEmailSend,
  registerRateLimited,
  unlimitedQuota,
} from "./quota.ts";
import { openStore, purgeStale, type Store } from "./store.ts";
import { requestContext, withClientIp } from "./request-context.ts";
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
import { buildCard, headTags, isCachedCard, renderCard, shareTarget, withHeadTags, type ShareKind } from "./share.ts";
import { addFollow, listFollows, MAX_FOLLOWS, removeAllFollows, removeFollow, verifyUnsubscribe } from "./follows.ts";
import { sendFollowAlerts, type AlertRun } from "./alerts.ts";
import { escapeHtml } from "./mailer.ts";
import { campaignOf, campaignReport, isCrawler, recordCampaignVisit } from "./campaigns.ts";

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
  "/assets/logo-polititia.png": "assets/logo-polititia.png",
  "/assets/logo-polititia-web.png": "assets/logo-polititia-web.png",
};

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
};

// The only Better Auth endpoints the dashboard needs. Everything else (the
// magic-link sender above all) would skip the checks of /api/register.
const AUTH_ROUTES = new Set(["GET /api/auth/magic-link/verify", "POST /api/auth/sign-out"]);

const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";
const RETURN_TO_PATTERN = /^\?[A-Za-z0-9=&_.%-]{1,400}$/;
const ADMIN_RETURN_TO = "/admin";
const PURGE_INTERVAL_MS = 60 * 60 * 1000;
const COMMUNE_SEARCHES_PER_MINUTE = 120;
const CARD_RENDERS_PER_MINUTE = 30;
const CARD_MAX_AGE_SECONDS = 24 * 60 * 60;
// Beyond this, one address is replaying links, not following them.
const CAMPAIGN_VISITS_PER_MINUTE = 10;

function simplePage(title: string, body: string, status = 200): Response {
  const html = `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <title>${escapeHtml(title)} · La parole des députés</title>
    <link rel="stylesheet" href="/styles.css?v=pages-1" />
  </head>
  <body class="page-body">
    <header class="page-header">
      <a class="page-back" href="/">← Retour à l’hémicycle</a>
      <p class="eyebrow">La parole des députés</p>
      <h1>${escapeHtml(title)}</h1>
    </header>
    <main class="page-main"><section class="page-card">${body}</section></main>
  </body>
</html>`;
  return new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

function bundleOrNull(config: AppConfig): DashboardBundle | null {
  try {
    return existsSync(config.dashboardDataPath) ? loadDashboardData(config.dashboardDataPath) : null;
  } catch {
    return null;
  }
}

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

function requestIp(): string {
  return requestContext.getStore()?.ip || "inconnue";
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
    const session = await auth.api.getSession({ headers: withClientIp(request.headers, requestIp()) });
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

  const adminEmails = new Set(config.adminEmails);
  const accountLimits = { perMinute: config.accountRequestsPerMinute, perDay: config.accountRequestsPerDay };
  const app = new Hono<{ Bindings: NodeBindings }>();
  const turnstile = config.turnstileSiteKey ? [TURNSTILE_ORIGIN] : [];

  let warnedUntrustedProxy = false;
  app.use("*", (c, next) => {
    const socketIp = c.env?.incoming?.socket?.remoteAddress || "inconnue";
    const ip = clientIp(c.req.raw.headers, config, socketIp);
    if (config.isProduction && !config.trustProxy && !warnedUntrustedProxy && c.req.header("x-forwarded-for")) {
      warnedUntrustedProxy = true;
      console.warn(
        "TRUST_PROXY is probably wrong: a request carries X-Forwarded-For while TRUST_PROXY=0." +
          " Every visitor may share the proxy's address, hence one quota. See /admin, « Adresse IP vue par le serveur ».",
      );
    }
    return requestContext.run({ ip, socketIp, headers: c.req.raw.headers }, next);
  });

  // Share cards are fetched by other sites' crawlers and may be cached. This
  // runs last on the way out, after secureHeaders and the no-store default.
  app.use("/og/*", async (c, next) => {
    await next();
    if (c.res.status === 200) {
      c.res.headers.set("Cache-Control", `public, max-age=${CARD_MAX_AGE_SECONDS}`);
      c.res.headers.set("Cross-Origin-Resource-Policy", "cross-origin");
    }
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
    if (!AUTH_ROUTES.has(`${c.req.method} ${c.req.path}`)) {
      return c.json({ error: "not_found" }, 404);
    }
    if (!sameOriginOrSafeGet(config, c.req.raw)) {
      return c.json({ error: "forbidden" }, 403);
    }
    return auth.handler(new Request(c.req.raw, { headers: withClientIp(c.req.raw.headers, requestIp()) }));
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
    const ip = requestIp();
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
    const ip = requestIp();
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
    const ip = requestIp();
    if (session?.user?.id) {
      const isAdmin = adminEmails.has(normalizeEmail(session.user.email || ""));
      if (!isAdmin && accountRateLimited(db, config.secret, session.user.id, accountLimits)) {
        return applyDeviceCookie(config, c.json({ error: "account_rate_limited" }, 429), deviceId);
      }
      recordActivity(db, session.user.id, geo.locate(ip, c.req.raw.headers), "request");
    } else {
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

  // « Trouver mon député » only maps a place to constituencies, so it is not metered.
  app.get("/api/communes", (c) => {
    if (!sameOriginOrSafeGet(config, c.req.raw)) {
      return c.json({ error: "forbidden" }, 403);
    }
    if (ipRateLimited(db, config.secret, "communes", requestIp(), COMMUNE_SEARCHES_PER_MINUTE)) {
      return c.json({ error: "rate_limited" }, 429);
    }
    const index = loadCommunes(config.communesPath);
    if (!index) {
      return c.json({ error: "communes_missing" }, 503);
    }
    const query = (c.req.query("q") || "").slice(0, 80);
    return c.json({ results: searchCommunes(index, query) });
  });

  const cardHost = new URL(config.baseURL).host;

  async function cardResponse(c: Context, kind: ShareKind, id: string) {
    const analytics = openAnalytics(config.analyticsPath);
    const bundle = bundleOrNull(config);
    const version = `${analytics?.meta.builtOn || ""}:${String(bundle?.meta.builtOn || "")}`;
    const cacheKey = `${kind}:${id}:${version}`;
    if (!isCachedCard(cacheKey)) {
      if (ipRateLimited(db, config.secret, "card", requestIp(), CARD_RENDERS_PER_MINUTE)) {
        return c.json({ error: "rate_limited" }, 429);
      }
    }
    const card = buildCard(kind, id, analytics, bundle);
    if (!card) {
      return c.json({ error: "not_found" }, 404);
    }
    const png = await renderCard(card, cardHost, cacheKey);
    return c.body(new Uint8Array(png), 200, { "Content-Type": "image/png" });
  }

  app.get("/og/accueil.png", (c) => cardResponse(c, "accueil", ""));

  app.get("/og/:kind{depute|groupe|theme}/:file{[^/]+\\.png}", (c) =>
    cardResponse(c, c.req.param("kind") as ShareKind, decodeURIComponent(c.req.param("file").slice(0, -4))),
  );

  app.post("/api/register", async (c) => {
    if (!originAllowed(config, c.req.header("origin"))) {
      return c.json({ error: "forbidden" }, 403);
    }
    const { deviceId } = deviceFromRequest(config, c.req.raw);
    const ip = requestIp();
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
    const dailyWait = emailDailyLimitSeconds(db, config.secret, email, EMAIL_MAX_PER_DAY);
    if (dailyWait > 0) {
      return applyDeviceCookie(config, c.json({ error: "email_daily_limit", retryAfter: dailyWait }, 429), deviceId);
    }

    // Only a query string of the dashboard is accepted, so the link can never
    // send the visitor to another path or origin.
    const returnTo = String(body.returnTo || "");
    const query = RETURN_TO_PATTERN.test(returnTo) ? returnTo.slice(1) : "";
    const callbackURL = returnTo === ADMIN_RETURN_TO ? ADMIN_RETURN_TO : `/?${query ? `${query}&` : ""}verifie=1`;
    await auth.api.signInMagicLink({
      body: { email, name: email.split("@")[0], callbackURL },
      headers: withClientIp(c.req.raw.headers, ip),
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
    const signedOut = await auth.api.signOut({ headers: withClientIp(c.req.raw.headers, requestIp()), asResponse: true });
    db.prepare(`DELETE FROM "user" WHERE id = ?`).run(user.id);
    if (user.email) {
      // Magic-link rows hold {"email","name"} as JSON; other verification rows may not be JSON.
      db.prepare(
        `DELETE FROM verification
         WHERE CASE WHEN json_valid(value) THEN lower(json_extract(value, '$.email')) END = ?`,
      ).run(normalizeEmail(user.email));
    }
    const response = c.json({ ok: true, deleted: true });
    for (const cookie of setCookiesOf(signedOut)) {
      response.headers.append("Set-Cookie", cookie);
    }
    return response;
  });

  function personName(bundle: DashboardBundle | null, id: string): { name: string; party: string } {
    const person = bundle?.politicians.find((item) => item.id === id);
    return { name: String(person?.name || id), party: String(person?.party || "") };
  }

  function followPayload(userId: string) {
    const bundle = bundleOrNull(config);
    return {
      limit: MAX_FOLLOWS,
      follows: listFollows(db, userId).map((follow) => ({ id: follow.politicianId, ...personName(bundle, follow.politicianId), since: follow.createdAt })),
    };
  }

  async function followUser(c: Context, write: boolean): Promise<{ id: string } | Response> {
    const sameOrigin = write ? originAllowed(config, c.req.header("origin")) : sameOriginOrSafeGet(config, c.req.raw);
    if (!sameOrigin) {
      return c.json({ error: "forbidden" }, 403);
    }
    const user = (await currentSession(auth, db, c.req.raw))?.user;
    if (!user?.id) {
      return c.json({ error: "not_signed_in" }, 401);
    }
    return { id: user.id };
  }

  app.get("/api/follows", async (c) => {
    const user = await followUser(c, false);
    return user instanceof Response ? user : c.json(followPayload(user.id));
  });

  app.post("/api/follows", async (c) => {
    const user = await followUser(c, true);
    if (user instanceof Response) {
      return user;
    }
    let body: { politicianId?: string };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }
    const politicianId = String(body.politicianId || "");
    if (!bundleOrNull(config)?.politicians.some((person) => person.id === politicianId)) {
      return c.json({ error: "not_found" }, 404);
    }
    const since = openAnalytics(config.analyticsPath)?.meta.lastDate || new Date().toISOString().slice(0, 10);
    const result = addFollow(db, user.id, politicianId, since);
    if (result === "limit") {
      return c.json({ error: "follow_limit", limit: MAX_FOLLOWS }, 400);
    }
    return c.json({ ok: true, added: result === "added", ...followPayload(user.id) });
  });

  app.delete("/api/follows/:id", async (c) => {
    const user = await followUser(c, true);
    if (user instanceof Response) {
      return user;
    }
    removeFollow(db, user.id, c.req.param("id"));
    return c.json({ ok: true, ...followPayload(user.id) });
  });

  // Linked from every alert. Mail scanners open links, so GET only asks for
  // confirmation; the POST (also used by one-click List-Unsubscribe) acts.
  function unsubscribeTarget(c: Context) {
    const userId = c.req.query("u") || "";
    const politicianId = c.req.query("p") || "";
    if (!userId || !verifyUnsubscribe(config.secret, userId, politicianId, c.req.query("t") || "")) {
      return null;
    }
    return { userId, politicianId };
  }

  const invalidUnsubscribe = () =>
    simplePage(
      "Lien de désabonnement invalide",
      "<p>Ce lien est incomplet ou a été modifié. Utilisez celui de votre dernier email, ou gérez vos alertes depuis « Mon compte » sur le site.</p>",
      400,
    );

  app.get("/desabonnement", (c) => {
    const target = unsubscribeTarget(c);
    if (!target) {
      return invalidUnsubscribe();
    }
    const what = target.politicianId
      ? `les alertes sur ${personName(bundleOrNull(config), target.politicianId).name}`
      : "toutes vos alertes « Suivre mon député »";
    const query = new URLSearchParams({ u: target.userId, ...(target.politicianId ? { p: target.politicianId } : {}), t: c.req.query("t") || "" });
    return simplePage(
      "Arrêter les alertes",
      `<p>Vous allez arrêter ${escapeHtml(what)}. Votre compte reste actif.</p>
       <form method="post" action="/desabonnement?${escapeHtml(query.toString())}">
         <button class="page-button" type="submit">Confirmer</button>
       </form>`,
    );
  });

  app.post("/desabonnement", (c) => {
    const target = unsubscribeTarget(c);
    if (!target) {
      return invalidUnsubscribe();
    }
    if (target.politicianId) {
      removeFollow(db, target.userId, target.politicianId);
    } else {
      removeAllFollows(db, target.userId);
    }
    return simplePage(
      "C’est noté",
      `<p>Vous ne recevrez plus ${target.politicianId ? `d’alerte sur ${escapeHtml(personName(bundleOrNull(config), target.politicianId).name)}` : "aucune alerte"}. Vous pouvez suivre à nouveau un député depuis sa fiche.</p>`,
    );
  });

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

  app.get("/api/admin/ip-check", async (c) => {
    const check = await requireAdmin(c, false);
    if ("response" in check) {
      return check.response;
    }
    const socketIp = requestContext.getStore()?.socketIp || "inconnue";
    return c.json(describeClientIp(c.req.raw.headers, config, socketIp));
  });

  type AlertJob = { startedAt: string; startedBy: string; finishedAt: string | null; run: AlertRun | null; error: string | null };
  let alertJob: AlertJob | null = null;

  app.get("/api/admin/campaigns", async (c) => {
    const check = await requireAdmin(c, false);
    if ("response" in check) {
      return check.response;
    }
    return c.json(campaignReport(db));
  });

  app.get("/api/admin/alerts", async (c) => {
    const check = await requireAdmin(c, false);
    if ("response" in check) {
      return check.response;
    }
    const analytics = openAnalytics(config.analyticsPath);
    if (!analytics) {
      return c.json({ error: "analytics_missing" }, 503);
    }
    const bundle = bundleOrNull(config);
    const preview = await sendFollowAlerts(config, db, analytics, bundle, { dryRun: true });
    const totals = db.prepare("SELECT COUNT(*) AS follows, COUNT(DISTINCT user_id) AS followers FROM follows").get() as {
      follows: number;
      followers: number;
    };
    const top = (
      db
        .prepare("SELECT politician_id AS id, COUNT(*) AS followers FROM follows GROUP BY politician_id ORDER BY followers DESC, id LIMIT 10")
        .all() as Array<{ id: string; followers: number }>
    ).map((row) => {
      const person = personName(bundle, row.id);
      const party = ((bundle?.parties || []) as Array<{ id?: string; label?: string }>).find((item) => item.id === person.party);
      return { ...person, party: String(party?.label || person.party), id: row.id, followers: Number(row.followers) };
    });
    return c.json({
      preview,
      follows: Number(totals.follows),
      followers: Number(totals.followers),
      top,
      job: alertJob,
      hasMailer: config.hasMailer,
    });
  });

  // Sending takes a while (the mail API is rate limited): the job runs in the
  // background and GET /api/admin/alerts reports it.
  app.post("/api/admin/alerts/send", async (c) => {
    const check = await requireAdmin(c, true);
    if ("response" in check) {
      return check.response;
    }
    if (!config.hasMailer) {
      return c.json({ error: "mailer_missing" }, 400);
    }
    if (alertJob && !alertJob.finishedAt) {
      return c.json({ error: "already_running", job: alertJob }, 409);
    }
    const analytics = openAnalytics(config.analyticsPath);
    if (!analytics) {
      return c.json({ error: "analytics_missing" }, 503);
    }
    const job: AlertJob = { startedAt: new Date().toISOString(), startedBy: check.admin.email, finishedAt: null, run: null, error: null };
    alertJob = job;
    sendFollowAlerts(config, db, analytics, bundleOrNull(config))
      .then((run) => {
        job.run = run;
      })
      .catch((error: Error) => {
        job.error = error.message;
      })
      .finally(() => {
        job.finishedAt = new Date().toISOString();
      });
    return c.json({ ok: true, job });
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
      if (relative === "index.html") {
        const analytics = openAnalytics(config.analyticsPath);
        const bundle = bundleOrNull(config);
        const query = new URL(c.req.url).searchParams;
        const campaign = campaignOf(query);
        if (campaign && !isCrawler(c.req.raw) && !ipRateLimited(db, config.secret, "campaign", requestIp(), CAMPAIGN_VISITS_PER_MINUTE)) {
          recordCampaignVisit(db, campaign);
        }
        const target = shareTarget(query, bundle, analytics);
        const html = withHeadTags(readFileSync(absolute, "utf8"), headTags(config.baseURL, target, bundle, analytics));
        return new Response(html, {
          headers: { "Content-Type": CONTENT_TYPES[ext], "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
        });
      }
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
