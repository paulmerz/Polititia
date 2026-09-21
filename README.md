# Polititia NLP Project

Static dashboard and data-analysis pipeline for French parliamentary speech
transcripts from the Assemblee nationale open-data Syceron XML archive.

## Data Source

Raw XML is not committed. Download it from the official Assemblee nationale
open-data endpoint:

https://data.assemblee-nationale.fr/travaux-parlementaires/debats

The downloader writes the archive and extracted XML under `data/raw/`, which is
ignored by git.

## Rebuild Pipeline

Run from the repository root.

```bash
uv run python scripts/download_assemblee_data.py
uv run python extract_speeches.py "data/raw/xml/compteRendu/*.xml" "extracted_texts/project_full"
uv run python analyze_project_ngrams.py \
  --speaker-dir "extracted_texts/project_full/by_speaker" \
  --out-dir "analysis_outputs/plain_project_content_stable" \
  --token-mode surface_content \
  --ngram-sizes 1 2 3 4 \
  --top-k 25 \
  --min-distinctive-count 50
uv run python dashboard/build_dashboard_data.py
```

## Serve Dashboard

The dashboard is no longer a static dump of every phrase. A small Node server
meters per-politician analysis, captures emails, and keeps sessions in a local
SQLite file (`server/data/auth.sqlite`) plus an append-only `emails.jsonl`.

```bash
cp server/.env.example server/.env
# set BETTER_AUTH_SECRET to a 32+ character random string before production
cd server && npm install && npm start
```

Open http://127.0.0.1:8000. Anonymous visitors can open 10 deputy analyses
(IP **and** device cookie). Further analyses require an email. With no mailer
configured, submitting the email creates the session immediately (the email is
still stored). Set `RESEND_API_KEY` and `EMAIL_FROM` to send a Better Auth
magic link instead.

Do not use `python -m http.server` for the dashboard in production: it would
serve `dashboard/data/` in full and bypass the quota.

Production checklist:

- `NODE_ENV=production`
- `BETTER_AUTH_SECRET` (>= 32 chars) and `BETTER_AUTH_URL=https://...`
- `HOST=127.0.0.1` behind a reverse proxy, with `TRUST_PROXY=1`
- optional `ADMIN_TOKEN` for `GET /api/admin/emails`
- `server/data/` is not published (gitignored)

```bash
cd server && npm test
```

Optional per-speaker distribution export:

```bash
uv run python ngram_distribution.py "extracted_texts/project_full/by_speaker" \
  --out "analysis_outputs/ngram_distribution_project_full_surface.csv" \
  --ngram-sizes 1 2 3 4 \
  --top-k 20 \
  --token-mode surface
```

The documented pipeline has no third-party dependencies. The optional
`lemma_content` modes use spaCy and can be run with:

```bash
uv run --extra lemma python analyze_project_ngrams.py --token-mode lemma_content
```

## Ignored Outputs

- `data/raw/`
- `extracted_texts/`
- `analysis_outputs/`
- `dashboard/data/`
