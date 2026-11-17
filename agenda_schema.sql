-- agenda.sqlite, written by build_agenda_db.py from the Assemblée nationale
-- Agenda dataset (repository/17/vp/reunions/Agenda.json.zip). Rebuilt every
-- day, apart from analytics.sqlite. Dates are "YYYY-MM-DD"; timestamps keep
-- the offset the Assembly publishes ("2025-11-07T21:30:00+01:00").
-- state, for meetings and items: 'confirme', 'eventuel', 'annule', 'supprime'.
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
-- kind: 'seance' (public sitting), 'commission' (standing and special
-- committees, inquiries, delegations, joint committees...), 'initiative'
-- (study and friendship groups). organ_type is the AMO codeType ('' when the
-- organ is not in the AMO download). The dataset also announces Senate
-- sittings (organ_type 'SENAT'): keep organ_type = 'ASSEMBLEE' for the
-- Assembly's own. report_ref is the compte rendu uid: for an Assembly sitting
-- it equals speeches.session_uid in analytics.sqlite. topics lists the
-- convocation items, the only order of business most committee meetings have.
CREATE TABLE meetings (
  uid TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  state TEXT NOT NULL,
  date TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  organ_ref TEXT NOT NULL,
  organ_name TEXT NOT NULL,
  organ_short TEXT NOT NULL,
  organ_type TEXT NOT NULL,
  place TEXT NOT NULL,
  report_ref TEXT NOT NULL,
  sitting_number TEXT NOT NULL,
  video INTEGER NOT NULL,
  open_to_press INTEGER NOT NULL,
  topics TEXT NOT NULL
);
CREATE INDEX meetings_date ON meetings (date);
CREATE INDEX meetings_organ_date ON meetings (organ_ref, date);
-- Items of the order of business, in published order. nature is the raw
-- natureTravauxODJ code (ODJPR, ODJAN, ODJSN...), kept uninterpreted.
-- conference_date is the Conférence des présidents date, rarely published.
CREATE TABLE agenda_items (
  uid TEXT PRIMARY KEY,
  meeting_uid TEXT NOT NULL,
  position INTEGER NOT NULL,
  state TEXT NOT NULL,
  item_type TEXT NOT NULL,
  subject TEXT NOT NULL,
  procedure TEXT NOT NULL,
  nature TEXT NOT NULL,
  conference_date TEXT NOT NULL
);
CREATE INDEX agenda_items_meeting ON agenda_items (meeting_uid, position);
-- dossier_title is '' when the dossier is not in the dossiers download.
CREATE TABLE agenda_item_dossiers (
  item_uid TEXT NOT NULL,
  dossier_uid TEXT NOT NULL,
  dossier_title TEXT NOT NULL,
  PRIMARY KEY (item_uid, dossier_uid)
) WITHOUT ROWID;
CREATE INDEX agenda_item_dossiers_dossier ON agenda_item_dossiers (dossier_uid);
-- Each dossier an agenda item refers to, with what the agenda page shows next
-- to it. kind: 'projet' (Government bill), 'proposition' (Members' bill),
-- 'resolution' or ''. origin: 'assemblee' or 'senat', where the text was
-- first deposited (a Senate proposition has a senator as author).
-- committee: the committee in charge (au fond). author_*: the first author of
-- a proposition or a resolution and his or her group (party code, as in analytics.sqlite) on
-- the deposit date, else the latest group of this legislature ('' for a
-- senator); coauthors counts the other authors the dossier lists.
-- themes: JSON list of {"id", "label"} from the curated
-- lexicon, read from the dossier title and the items' subjects
-- (analyze_themes.title_themes); [] when they name none.
CREATE TABLE dossiers (
  uid TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  kind TEXT NOT NULL,
  origin TEXT NOT NULL,
  procedure TEXT NOT NULL,
  deposited_on TEXT NOT NULL,
  committee_ref TEXT NOT NULL,
  committee_name TEXT NOT NULL,
  author_id TEXT NOT NULL,
  author_name TEXT NOT NULL,
  author_group TEXT NOT NULL,
  coauthors INTEGER NOT NULL,
  themes TEXT NOT NULL
);
-- Committee attendance as published with each meeting: every member of the
-- organ, status 'present', 'excuse' or 'absent'. Information missions publish
-- none. Checked against the committee reports (roadmap.md § 6.1).
CREATE TABLE attendance (
  meeting_uid TEXT NOT NULL,
  acteur_id TEXT NOT NULL,
  status TEXT NOT NULL,
  PRIMARY KEY (meeting_uid, acteur_id)
) WITHOUT ROWID;
CREATE INDEX attendance_acteur ON attendance (acteur_id, meeting_uid);
