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
  speakers' actual key votes.
- `dashboard/build_dashboard_data.py` writes the small first-load bundle
  `dashboard/data/dashboard-data.json` (people, groups, style markers).

`uv run --extra topics --with pytest pytest -q` runs the Python tests.

## Serve Dashboard

A small Node server (Hono, Better Auth, SQLite) serves the dashboard and
answers every analysis from `analytics.sqlite`. Sessions and the free-analysis
counter live in `server/data/auth.sqlite`.

```bash
cp server/.env.example server/.env
# set BETTER_AUTH_SECRET to a 32+ character random string before production
cd server && npm install && npm start
```

Open http://127.0.0.1:8000.

- The first screen is free. Each analysis a visitor asks for (a deputy, a
  group, a theme or the Assembly, for a period) counts once, whatever the
  number of requests behind it; seeing it again is free.
- After 10 analyses (IP **and** device cookie), access stays free once the
  visitor confirms an email: a magic link, valid 15 minutes. The address is
  stored only after the link is opened, and only to tell people from robots.
  A honeypot field, a disposable-domain list, a per-IP rate limit, a resend
  cooldown and optional Cloudflare Turnstile protect the form.
- With no mailer configured (development only), the link is logged and shown
  in the browser.
- `/conditions` states the terms and retention; `/methode` explains how themes,
  distinctive phrases, votes and estimated stances are computed.

Do not serve `dashboard/` with a static server in production: the analyses
would bypass the quota.

Environment (`server/.env`):

| Variable | Purpose |
| --- | --- |
| `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` | Session signing and public URL (https in production) |
| `HOST`, `PORT`, `TRUST_PROXY` | Bind address; set `TRUST_PROXY=1` behind a reverse proxy |
| `FREE_REQUEST_LIMIT` | Free analyses before the email (default 10) |
| `RESEND_API_KEY`, `EMAIL_FROM` | Magic-link mailer, required in production |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | Optional captcha on the email form (both or neither) |
| `ANALYTICS_DB_PATH` | Defaults to `analysis_outputs/analytics.sqlite` |
| `DASHBOARD_DATA_PATH`, `DATA_DIR` | First-load bundle and server data directory |
| `AUTH_TRUSTED_ORIGINS`, `ALLOW_INSECURE_HTTP` | Extra allowed origins; plain HTTP outside production |
| `STANCE_LLM_URL`, `STANCE_LLM_MODEL`, `STANCE_LLM_KEY` | Optional LLM classifier for `analyze_stances.py` |

Production checklist:

- `NODE_ENV=production`
- `BETTER_AUTH_SECRET` (>= 32 chars) and `BETTER_AUTH_URL=https://...`
- `RESEND_API_KEY` and `EMAIL_FROM`
- `HOST=127.0.0.1` behind a reverse proxy, with `TRUST_PROXY=1`
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

## Ignored Outputs

- `data/raw/`
- `extracted_texts/`
- `analysis_outputs/`
- `dashboard/data/`
