# Polititia NLP Project

"La parole des députés": what each deputy and group says, votes and announces
in the Assemblée nationale, for any period of the 17th legislature. Built from
the Assemblée nationale open data (Syceron debate XML, actors and organs,
public votes, legislative files).

## Data Sources

Raw data is not committed. Both downloaders write under `data/raw/`, which is
ignored by git.

- Debates (comptes rendus): https://data.assemblee-nationale.fr/travaux-parlementaires/debats
- Actors, mandates and organs (AMO), public votes (scrutins) and legislative files (dossiers).

## Rebuild Pipeline

Run from the repository root.

```bash
uv run python scripts/download_assemblee_data.py
uv run python scripts/download_open_data.py
uv run python extract_speeches.py "data/raw/xml/compteRendu/*.xml" "extracted_texts/project_full"
uv run --extra topics python analyze_themes.py
uv run python analyze_stances.py
uv run python build_analytics_db.py
uv run python dashboard/build_dashboard_data.py
uv run python scripts/build_communes.py
```

- `extract_speeches.py` writes the dated speech index
  `extracted_texts/project_full/speeches.jsonl` (agenda item, bill number,
  article, `acteur_id`) and one file per speaker.
- `analyze_themes.py` attributes speeches to the curated themes of
  `themes/lexicon.json`: first by the bill being debated and its committee,
  then by keyword density (never a single keyword). Output:
  `analysis_outputs/themes/`.
- `analyze_stances.py` finds explicit vote announcements ("nous voterons ce
  texte") with high-precision rules, evaluates them on
  `stances/gold/stance_labels.jsonl` and only publishes methods whose measured
  precision is at least 85 %. `--nli` adds a zero-shot NLI classifier (needs
  `transformers`). Output: `analysis_outputs/stances/`.
- `build_analytics_db.py` builds `analysis_outputs/analytics.sqlite`: monthly
  aggregates, n-gram counts, theme attributions, votes and stances, so the
  server can answer for any period. It also checks the stances against the
  speakers' actual key votes. N-gram counts per speaker and group also record
  the number of distinct sittings: a distinctive phrase must come from at
  least 3 sittings, and its "×N" ratio is only shown with at least 10 uses by
  the speaker and 20 by everyone else (otherwise the raw counts are shown).
- `dashboard/build_dashboard_data.py` writes the small first-load bundle
  `dashboard/data/dashboard-data.json` (people, groups, style markers, and
  each deputy's constituency from AMO).
- `scripts/build_communes.py` writes `dashboard/data/communes.json`, the
  commune and postal code → constituency table behind « Trouver mon député »
  (INSEE, La Poste, and the 2024 polling stations for the arrondissements of
  Paris, Lyon and Marseille; sources cached under `data/raw/geo/`). It ends
  with a coverage check against the open seats.

`uv run --extra topics --with pytest pytest -q` runs the Python tests.

## Serve Dashboard

A small Node server (Hono, Better Auth, SQLite) serves the dashboard and
answers every analysis from `analytics.sqlite`. Sessions and the free-analysis
counter live in `server/data/auth.sqlite`.

Node.js 22.13 or newer is required (`node -v`). From `server/`, install dependencies once, then start. `npm start` runs the TypeScript entry with Node itself. Sessions are stored with Node's built-in SQLite, so the install does not compile a native module and does not need Visual Studio or `pnpm approve-builds`.

```bash
cp server/.env.example server/.env
# set BETTER_AUTH_SECRET to a 32+ character random string before production
cd server
npm install
npm start
```

On Windows Command Prompt the same two commands apply. `npm start` alone fails with « tsx n'est pas reconnu » when `npm install` has not been run in `server/`.

Open http://127.0.0.1:8000.

- The first screen is free. Each analysis a visitor asks for (a deputy, a
  group, a theme or the Assembly, for a period) counts once, whatever the
  number of requests behind it; seeing it again is free.
- After 10 analyses (IP **and** device cookie), access stays free once the
  visitor confirms an email: a magic link, valid 15 minutes. The address is
  stored only after the link is opened, and only to tell people from robots.
  A honeypot field, a disposable-domain list, a per-IP rate limit, a resend
  cooldown, at most 5 links per address and per day, and optional Cloudflare
  Turnstile protect the form.
- Signed-in accounts have no analysis quota, only a ceiling against scraping
  (`ACCOUNT_REQUESTS_PER_MINUTE`, `ACCOUNT_REQUESTS_PER_DAY`); administrators
  are not limited.
- With no mailer configured (development on this machine only: `HOST` and
  `BETTER_AUTH_URL` on localhost), the link is logged and shown in the
  browser. Outside localhost, development mode refuses to start without
  `BETTER_AUTH_SECRET` and never shows the link.
- Only two Better Auth routes are reachable: `GET /api/auth/magic-link/verify`
  and `POST /api/auth/sign-out`. Links are always requested through
  `/api/register`, so its checks cannot be skipped.
- `/conditions` states the terms and retention; `/methode` explains how themes,
  distinctive phrases, votes and estimated stances are computed.
- `GET /api/communes?q=` (free, same origin, 120 per minute and per IP)
  searches communes by name or postal code; without `communes.json` it
  answers 503 and the dashboard hides the finder.
- Shared links show a card: the server injects the Open Graph and Twitter tags
  of `?depute=`, `?groupe=` or `?theme=` into the page, and draws the
  1200×630 PNG at `/og/depute/<id>.png` (also `groupe`, `theme`,
  `accueil.png`). Cards are cached in memory and for a day by clients; new
  renders are limited to 30 per minute and per IP.

When `SIGNUP_NOTIFY_EMAIL` is set, each new account triggers a notification to
that address with the user's email and IP address. There is no default
recipient: without the variable (or with `off`), nobody is notified and the
server warns at start in production. It is sent through the same Resend
mailer, so it requires `RESEND_API_KEY` and `EMAIL_FROM`.

The client IP (quota, sign-up limit, Better Auth rate limit, notification) is
the socket address unless `TRUST_PROXY` says otherwise:

- `TRUST_PROXY=1` (or `2`, `3`…): that many reverse proxies append to
  `X-Forwarded-For`. The address is read from the right, so entries a client
  adds on the left are ignored. A count larger than the real chain lets
  clients choose their address again; a smaller one gives everyone the
  proxy's address.
- `TRUST_PROXY=cloudflare`: the server is only reachable through Cloudflare.
  The IP comes from `CF-Connecting-IP`, the location from `CF-IPCountry` and
  `CF-IPCity`.

In production, the server logs a warning once if a request carries
`X-Forwarded-For` while `TRUST_PROXY=0`.

#### Setting TRUST_PROXY on Render

Render runs the service behind its own proxies (Cloudflare, then Render's load
balancer), even without a Cloudflare account of yours; a custom domain proxied
by your own Cloudflare zone adds more. The service must listen on `0.0.0.0`,
so with `TRUST_PROXY=0` every visitor gets the proxy's address and shares one
quota. The admin page measures the chain instead of guessing it:

1. Set `ADMIN_EMAILS` on Render and deploy.
2. Open `/admin`, section « Adresse IP vue par le serveur ». Compare « votre
   adresse probable » with the address https://ifconfig.me shows in the same
   browser.
3. If they match, set the suggested value (`TRUST_PROXY=2`, for instance) in
   the service's Environment and redeploy.
4. Back on `/admin`, the address kept by the server must be yours, and
   « Tester l'usurpation » must succeed (a forged `X-Forwarded-For`, plus a
   forged `CF-Connecting-IP` with `TRUST_PROXY=cloudflare`, does not change
   it). If it fails, the value is too high.
5. Sign up with a test address and check that the IP in the signup
   notification is yours.

Do not serve `dashboard/` with a static server in production: the analyses
would bypass the quota.

### Administration

`/admin` lists the accounts and lets an administrator block or unblock them.
It also shows each account's requests (today, 7 days, 30 days, total), the
daily requests over 30 days, and where accounts connect from (countries and
cities). Only signed-in accounts whose email is listed in `ADMIN_EMAILS`
(comma-separated) can open it; without `ADMIN_EMAILS`, `/admin` and
`/api/admin/*` answer 404. The page has its own magic-link form.

- A request is one analysis call (deputy, group, theme, Assembly) made by a
  signed-in account. Anonymous visitors are not tied to an account: only
  their 30-day total appears.
- Blocking closes the account's sessions at once, refuses new sessions and
  refuses to send it a new link. The person falls back to the anonymous free
  quota. Administrators cannot be blocked.
- The location is the country and city deduced from the IP address at sign-in
  and at each request. The IP address itself is not stored for this. With
  `TRUST_PROXY=cloudflare`, the `CF-IPCountry` and `CF-IPCity` headers are
  used. Otherwise, download the free DB-IP Lite database (CC BY 4.0) once
  a month:

```bash
cd server
npm run geoip               # city precision, about 130 MB on disk and in memory
npm run geoip -- --country  # country only, about 8 MB
```

The running server reloads the file within 10 minutes. On hosts where the
data disk is only mounted at runtime (Render), start with
`npm run geoip -- --if-stale && npm start`: the file is only downloaded when
missing or older than 30 days, and a failed download never blocks the start. Request counts and
locations are kept 12 months and deleted with the account.

### « Suivre mon député » alerts

A signed-in account can follow up to 10 deputies (`GET/POST /api/follows`,
`DELETE /api/follows/:id`); an anonymous visitor who clicks « Suivre » goes
through the email form and the follow is applied when the link is opened.
After each corpus update, send the alerts from `/admin` (section « Alertes »)
or from the command line:

```bash
cd server
npm run alerts            # dry run: who would receive what
npm run alerts -- --send  # send (needs RESEND_API_KEY and EMAIL_FROM)
```

Each account gets one email covering what its deputies said and voted since
the previous alert, and nothing when there is nothing new. Every email carries
one-click unsubscribe links (`/desabonnement`, signed with
`BETTER_AUTH_SECRET`, plus the `List-Unsubscribe` headers); follows are
deleted with the account.

### Launch outreach files

```bash
cd server
npm run outreach -- --base https://your-domain
```

writes, under `outreach/` (gitignored, it holds contact data):

- `deputes.csv`: one row per sitting deputy who has a page, with their AMO
  address (the `@assemblee-nationale.fr` one when there are several), their
  figures, a personal subject line and opening sentence, and a link with UTM
  tags. Semicolons and a byte order mark, for Excel and mail-merge tools.
- `modele-email-depute.txt`: the message, with `{{column}}` fields.
- `pqr/<dept>-<name>.md` and `pqr/index.csv`: one press dossier per
  department for the regional papers (angles, table of the deputies,
  quotes with their report links, method).

Every link carries `utm_source`, `utm_medium` and `utm_campaign`
(`depute`/`lancement-deputes`, `presse`/`pqr-<dept>`). When the dashboard
page is opened with them, the server adds one to a per-day total for that
source, medium and campaign (`campaign_visits`: no address, no cookie, kept
two years); link previews, crawlers and prefetches are not counted, nor more
than 10 visits a minute from one address. `/admin`, section « Campagnes »,
shows the last 90 days. The dashboard then drops the tags from the address
bar, so a link shared onwards does not inherit the campaign.

Deputies without a page (a recent substitute who has not spoken, the
President of the Assembly) are listed on the console and left out. The
script needs the AMO download (`--amo` to point elsewhere).

Environment (`server/.env`):

| Variable | Purpose |
| --- | --- |
| `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` | Session signing and public URL (https in production) |
| `HOST`, `PORT`, `TRUST_PROXY` | Bind address; `TRUST_PROXY` = number of reverse proxies, or `cloudflare` (see above) |
| `FREE_REQUEST_LIMIT` | Free analyses before the email (default 10) |
| `ACCOUNT_REQUESTS_PER_MINUTE`, `ACCOUNT_REQUESTS_PER_DAY` | Ceilings for signed-in accounts, administrators excepted (default 120 and 2000 analysis requests) |
| `RESEND_API_KEY`, `EMAIL_FROM` | Magic-link mailer, required in production |
| `SIGNUP_NOTIFY_EMAIL` | Recipient of the new-account notification (no default: empty or `off` disables it) |
| `ADMIN_EMAILS` | Comma-separated accounts allowed on `/admin` (empty disables it) |
| `GEOIP_DB_PATH` | MMDB file for the admin geography (default `server/data/geoip.mmdb`, see `npm run geoip`) |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | Optional captcha on the email form (both or neither) |
| `ANALYTICS_DB_PATH` | Defaults to `analysis_outputs/analytics.sqlite` |
| `DASHBOARD_DATA_PATH`, `DATA_DIR` | First-load bundle and server data directory |
| `COMMUNES_PATH` | Commune table for « Trouver mon député » (default `dashboard/data/communes.json`) |
| `AUTH_TRUSTED_ORIGINS`, `ALLOW_INSECURE_HTTP` | Extra allowed origins; plain HTTP outside production |
| `STANCE_LLM_URL`, `STANCE_LLM_MODEL`, `STANCE_LLM_KEY` | Optional LLM classifier for `analyze_stances.py` |

Production checklist:

- `NODE_ENV=production`
- `BETTER_AUTH_SECRET` (>= 32 chars) and `BETTER_AUTH_URL=https://...`
- `RESEND_API_KEY` and `EMAIL_FROM`
- `HOST=127.0.0.1` behind a reverse proxy (`0.0.0.0` on Render), with
  `TRUST_PROXY` set to the number of proxies (or `cloudflare`), checked on
  `/admin` (see « Setting TRUST_PROXY on Render »)
- `SIGNUP_NOTIFY_EMAIL` if new accounts should be notified
- `server/data/` is not published (gitignored)
- add the publisher's contact address to `dashboard/conditions.html`

```bash
cd server && npm test
```

## Dashboard

Four tabs: **Thèmes**, **Député**, **Groupe**, **Assemblée** (plus **Style**
in the detailed mode). The period selector (whole legislature, last 12 or 3
months, parliamentary sessions, custom months) applies everywhere, including
seat sizes, and the state is kept in the URL so any view can be shared.

The search box also takes a commune or a postal code and lists the deputies
of its constituencies (the welcome card and the deputy picker have the same
finder). Deputy, group and theme pages have a « Partager » menu (WhatsApp, X,
Bluesky, Facebook, LinkedIn, email, copy link); deputy pages have « Suivre ».

## Ignored Outputs

- `data/raw/`
- `extracted_texts/`
- `analysis_outputs/`
- `dashboard/data/`
- `outreach/`
