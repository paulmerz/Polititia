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
