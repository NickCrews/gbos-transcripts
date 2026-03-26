/**
 * Test database factory: creates an in-memory SQLite database with the full schema.
 */

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "../../db/schema";

// Raw SQL schema matching db.py (we can't use drizzle-kit in tests easily)
const SCHEMA_SQL = `
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS municipalities (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  short_name    TEXT NOT NULL UNIQUE,
  state         TEXT,
  country       TEXT DEFAULT 'US',
  youtube_channel_url TEXT,
  website_url   TEXT,
  created_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS people (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  voice_embedding BLOB,
  voice_sample_count INTEGER DEFAULT 0,
  created_at    TEXT DEFAULT (datetime('now')),
  updated_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS roles (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id     INTEGER NOT NULL REFERENCES people(id),
  municipality_id INTEGER NOT NULL REFERENCES municipalities(id),
  role          TEXT NOT NULL,
  title         TEXT,
  start_date    TEXT,
  end_date      TEXT,
  created_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS meetings (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  municipality_id INTEGER NOT NULL REFERENCES municipalities(id),
  youtube_id      TEXT UNIQUE NOT NULL,
  title           TEXT NOT NULL,
  meeting_date    TEXT,
  meeting_type    TEXT,
  duration_secs   REAL,
  youtube_url     TEXT GENERATED ALWAYS AS ('https://www.youtube.com/watch?v=' || youtube_id) STORED,
  audio_path      TEXT,
  transcript_path TEXT,
  status          TEXT DEFAULT 'pending',
  error_message   TEXT,
  created_at      TEXT DEFAULT (datetime('now')),
  updated_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS agenda_items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id    INTEGER NOT NULL REFERENCES meetings(id),
  item_number   TEXT,
  title         TEXT NOT NULL,
  item_type     TEXT,
  start_time    REAL,
  end_time      REAL,
  duration_secs REAL,
  created_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS segments (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id      INTEGER NOT NULL REFERENCES meetings(id),
  agenda_item_id  INTEGER REFERENCES agenda_items(id),
  person_id       INTEGER REFERENCES people(id),
  speaker_label   TEXT,
  text            TEXT NOT NULL,
  start_time      REAL NOT NULL,
  end_time        REAL NOT NULL,
  duration_secs   REAL GENERATED ALWAYS AS (end_time - start_time) STORED,
  confidence      REAL,
  created_at      TEXT DEFAULT (datetime('now'))
);

CREATE VIRTUAL TABLE IF NOT EXISTS segments_fts USING fts5(
  text,
  content='segments',
  content_rowid='id',
  tokenize='porter unicode61'
);

CREATE TRIGGER IF NOT EXISTS segments_ai AFTER INSERT ON segments BEGIN
  INSERT INTO segments_fts(rowid, text) VALUES (new.id, new.text);
END;
CREATE TRIGGER IF NOT EXISTS segments_ad AFTER DELETE ON segments BEGIN
  INSERT INTO segments_fts(segments_fts, rowid, text) VALUES('delete', old.id, old.text);
END;
CREATE TRIGGER IF NOT EXISTS segments_au AFTER UPDATE OF text ON segments BEGIN
  INSERT INTO segments_fts(segments_fts, rowid, text) VALUES('delete', old.id, old.text);
  INSERT INTO segments_fts(rowid, text) VALUES (new.id, new.text);
END;

CREATE TABLE IF NOT EXISTS summaries (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id      INTEGER NOT NULL REFERENCES meetings(id),
  agenda_item_id  INTEGER REFERENCES agenda_items(id),
  summary_text    TEXT NOT NULL,
  model_used      TEXT,
  created_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  query           TEXT NOT NULL,
  mode            TEXT DEFAULT 'hybrid',
  webhook_url     TEXT,
  email           TEXT,
  municipality_id INTEGER REFERENCES municipalities(id),
  created_at      TEXT DEFAULT (datetime('now')),
  last_notified_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_roles_person ON roles(person_id);
CREATE INDEX IF NOT EXISTS idx_roles_municipality ON roles(municipality_id);
CREATE INDEX IF NOT EXISTS idx_meetings_municipality ON meetings(municipality_id);
CREATE INDEX IF NOT EXISTS idx_meetings_date ON meetings(meeting_date);
CREATE INDEX IF NOT EXISTS idx_meetings_status ON meetings(status);
CREATE INDEX IF NOT EXISTS idx_agenda_items_meeting ON agenda_items(meeting_id);
CREATE INDEX IF NOT EXISTS idx_segments_meeting ON segments(meeting_id);
CREATE INDEX IF NOT EXISTS idx_segments_person ON segments(person_id);
CREATE INDEX IF NOT EXISTS idx_segments_time ON segments(meeting_id, start_time);
`;

export type TestDb = ReturnType<typeof createTestDb>;

export function createTestDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(SCHEMA_SQL);
  const db = drizzle(sqlite, { schema });
  // Expose sqlite for raw queries in tests
  (db as any)._sqlite = sqlite;
  return db;
}

/** Returns the underlying better-sqlite3 instance for raw query access. */
export function getRawSqlite(db: TestDb): Database.Database {
  return (db as any)._sqlite as Database.Database;
}
