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
uv run python scripts/index_session_dates.py
uv run --extra topics python analyze_topics.py
uv run python analyze_themes.py \
  --speeches extracted_texts/project_full/speeches.jsonl \
  --speaker-dir extracted_texts/project_full/by_speaker \
  --lexicon themes/lexicon.json \
  --out-dir analysis_outputs/themes
uv run python dashboard/build_dashboard_data.py
```

`extract_speeches.py` now writes a dated speech index at
`extracted_texts/project_full/speeches.jsonl`. `analyze_themes.py` attributes
those speeches to lexical domains in `themes/lexicon.json` and to emerging
bigram signals. Without the index, the dashboard keeps an empty theme lens.

## Serve Dashboard

Build `dashboard/data/dashboard-data.js` first with the pipeline command above,
then serve the dashboard directory:

```bash
uv run python -m http.server 8000 --directory dashboard
```

Open http://localhost:8000 in a browser. Stop the server with `Ctrl-C`.

Optional per-speaker distribution export:

```bash
uv run python ngram_distribution.py "extracted_texts/project_full/by_speaker" \
  --out "analysis_outputs/ngram_distribution_project_full_surface.csv" \
  --ngram-sizes 1 2 3 4 \
  --top-k 20 \
  --token-mode surface
```

The documented pipeline has no required third-party dependencies. Optional extras:

```bash
uv run --extra lemma python analyze_project_ngrams.py --token-mode lemma_content
uv run --extra topics python analyze_topics.py
```

The dashboard **Themes** tab needs the topic extra and `analyze_topics.py`.
The hemicycle **Theme** lens needs `analyze_themes.py` and the dated speech index.
Seat size (speeches vs words) is a client-side toggle. Without `speeches.jsonl`, the theme lens stays empty.

## Ignored Outputs

- `data/raw/`
- `extracted_texts/`
- `analysis_outputs/`
- `dashboard/data/`
