-- analytics.sqlite, written by build_analytics_db.py and read by server/src/analytics.ts.
-- Months are "YYYY-MM"; dates are "YYYY-MM-DD".
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE politicians (
  pid INTEGER PRIMARY KEY, id TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
  party TEXT NOT NULL, acteur_id TEXT NOT NULL
);
CREATE TABLE speeches (
  sid INTEGER PRIMARY KEY, speech_id TEXT UNIQUE NOT NULL, pid INTEGER NOT NULL,
  party TEXT NOT NULL, date TEXT NOT NULL, month TEXT NOT NULL, session_uid TEXT NOT NULL,
  debate_title TEXT NOT NULL, section_code TEXT NOT NULL, bill_number TEXT NOT NULL,
  words INTEGER NOT NULL, tokens INTEGER NOT NULL
);
CREATE INDEX speeches_pid_date ON speeches (pid, date);
CREATE INDEX speeches_date ON speeches (date);
CREATE INDEX speeches_party_date ON speeches (party, date);
CREATE TABLE ngrams (gid INTEGER PRIMARY KEY, n INTEGER NOT NULL, text TEXT NOT NULL, total INTEGER NOT NULL);
CREATE INDEX ngrams_n_total ON ngrams (n, total);
CREATE TABLE person_ngram_month (
  pid INTEGER, n INTEGER, month TEXT, gid INTEGER, count INTEGER,
  PRIMARY KEY (pid, n, month, gid)
) WITHOUT ROWID;
CREATE TABLE party_ngram_month (
  party TEXT, n INTEGER, month TEXT, gid INTEGER, count INTEGER,
  PRIMARY KEY (party, n, month, gid)
) WITHOUT ROWID;
CREATE TABLE global_ngram_month (
  gid INTEGER, month TEXT, count INTEGER, PRIMARY KEY (gid, month)
) WITHOUT ROWID;
CREATE TABLE person_totals (
  pid INTEGER, n INTEGER, month TEXT, total INTEGER, PRIMARY KEY (pid, n, month)
) WITHOUT ROWID;
CREATE TABLE party_totals (
  party TEXT, n INTEGER, month TEXT, total INTEGER, PRIMARY KEY (party, n, month)
) WITHOUT ROWID;
CREATE TABLE global_totals (n INTEGER, month TEXT, total INTEGER, PRIMARY KEY (n, month)) WITHOUT ROWID;
CREATE TABLE theme_attributions (
  sid INTEGER NOT NULL, theme TEXT NOT NULL, domain TEXT NOT NULL, method TEXT NOT NULL,
  relevance REAL, terms TEXT NOT NULL, excerpt TEXT NOT NULL, dossier_title TEXT NOT NULL,
  PRIMARY KEY (theme, sid)
) WITHOUT ROWID;
CREATE INDEX theme_attributions_sid ON theme_attributions (sid);
CREATE TABLE votes (
  vid INTEGER PRIMARY KEY, uid TEXT UNIQUE NOT NULL, number INTEGER NOT NULL, date TEXT NOT NULL,
  title TEXT NOT NULL, adopted INTEGER NOT NULL, vote_type TEXT NOT NULL, is_key INTEGER NOT NULL,
  dossier_title TEXT NOT NULL, group_majority TEXT NOT NULL, group_counts TEXT NOT NULL
);
CREATE INDEX votes_date ON votes (date);
CREATE TABLE vote_positions (
  vid INTEGER, pid INTEGER, party TEXT, position TEXT, PRIMARY KEY (pid, vid)
) WITHOUT ROWID;
CREATE INDEX vote_positions_vid ON vote_positions (vid);
CREATE INDEX vote_positions_party ON vote_positions (party, vid);
CREATE TABLE vote_themes (vid INTEGER, theme TEXT, PRIMARY KEY (theme, vid)) WITHOUT ROWID;
CREATE TABLE stances (
  sid INTEGER NOT NULL, theme TEXT NOT NULL, stance TEXT NOT NULL, confidence REAL NOT NULL,
  method TEXT NOT NULL, quote TEXT NOT NULL, PRIMARY KEY (theme, sid)
) WITHOUT ROWID;
CREATE INDEX stances_sid ON stances (sid);
