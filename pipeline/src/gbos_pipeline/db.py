"""Database schema creation and insert/query helpers.

The schema is also mirrored in api/src/db/schema.ts (Drizzle ORM).
Both sides read/write the same SQLite file.
"""

from __future__ import annotations

import sqlite3
import struct
from pathlib import Path
from typing import Any

import sqlite_vec


# ---------------------------------------------------------------------------
# Schema SQL
# ---------------------------------------------------------------------------

SCHEMA_SQL = """
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

------------------------------------------------------------
-- Multi-municipality support
------------------------------------------------------------
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

------------------------------------------------------------
-- People and roles
------------------------------------------------------------
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

------------------------------------------------------------
-- Meetings
------------------------------------------------------------
CREATE TABLE IF NOT EXISTS meetings (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    municipality_id INTEGER NOT NULL REFERENCES municipalities(id),
    youtube_id      TEXT UNIQUE NOT NULL,
    title           TEXT NOT NULL,
    meeting_date    TEXT,
    meeting_type    TEXT,
    duration_secs   REAL,
    youtube_url     TEXT GENERATED ALWAYS AS
                    ('https://www.youtube.com/watch?v=' || youtube_id) STORED,
    audio_path      TEXT,
    transcript_path TEXT,
    status          TEXT DEFAULT 'pending',
    error_message   TEXT,
    created_at      TEXT DEFAULT (datetime('now')),
    updated_at      TEXT DEFAULT (datetime('now'))
);

------------------------------------------------------------
-- Agenda items
------------------------------------------------------------
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

------------------------------------------------------------
-- Transcript segments
------------------------------------------------------------
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

-- Full-text search
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
    INSERT INTO segments_fts(segments_fts, rowid, text)
    VALUES('delete', old.id, old.text);
END;
CREATE TRIGGER IF NOT EXISTS segments_au AFTER UPDATE OF text ON segments BEGIN
    INSERT INTO segments_fts(segments_fts, rowid, text)
    VALUES('delete', old.id, old.text);
    INSERT INTO segments_fts(rowid, text) VALUES (new.id, new.text);
END;

------------------------------------------------------------
-- Summaries
------------------------------------------------------------
CREATE TABLE IF NOT EXISTS summaries (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    meeting_id      INTEGER NOT NULL REFERENCES meetings(id),
    agenda_item_id  INTEGER REFERENCES agenda_items(id),
    summary_text    TEXT NOT NULL,
    model_used      TEXT,
    created_at      TEXT DEFAULT (datetime('now'))
);

------------------------------------------------------------
-- Subscriptions
------------------------------------------------------------
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

------------------------------------------------------------
-- Indexes
------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_roles_person ON roles(person_id);
CREATE INDEX IF NOT EXISTS idx_roles_municipality ON roles(municipality_id);
CREATE INDEX IF NOT EXISTS idx_meetings_municipality ON meetings(municipality_id);
CREATE INDEX IF NOT EXISTS idx_meetings_date ON meetings(meeting_date);
CREATE INDEX IF NOT EXISTS idx_meetings_status ON meetings(status);
CREATE INDEX IF NOT EXISTS idx_agenda_items_meeting ON agenda_items(meeting_id);
CREATE INDEX IF NOT EXISTS idx_agenda_items_time ON agenda_items(meeting_id, start_time);
CREATE INDEX IF NOT EXISTS idx_segments_meeting ON segments(meeting_id);
CREATE INDEX IF NOT EXISTS idx_segments_person ON segments(person_id);
CREATE INDEX IF NOT EXISTS idx_segments_agenda ON segments(agenda_item_id);
CREATE INDEX IF NOT EXISTS idx_segments_time ON segments(meeting_id, start_time);
"""

VEC_TABLES_SQL = """
CREATE VIRTUAL TABLE IF NOT EXISTS vec_people USING vec0(
    person_id INTEGER PRIMARY KEY,
    voice_embedding float[256] distance_metric=cosine
);

CREATE VIRTUAL TABLE IF NOT EXISTS vec_segments USING vec0(
    segment_id INTEGER PRIMARY KEY,
    embedding float[384] distance_metric=cosine
);
"""


# ---------------------------------------------------------------------------
# Connection helpers
# ---------------------------------------------------------------------------

def open_db(path: Path | str, *, readonly: bool = False) -> sqlite3.Connection:
    """Open (or create) the SQLite database with sqlite-vec loaded."""
    uri = f"file:{path}{'?mode=ro' if readonly else ''}"
    conn = sqlite3.connect(uri, uri=True, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    sqlite_vec.load(conn)
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def create_schema(conn: sqlite3.Connection) -> None:
    """Create all tables, triggers, indexes, and virtual tables."""
    conn.executescript(SCHEMA_SQL)
    conn.executescript(VEC_TABLES_SQL)
    conn.commit()


def open_and_init(path: Path | str) -> sqlite3.Connection:
    """Open database and ensure schema exists."""
    conn = open_db(path)
    create_schema(conn)
    return conn


# ---------------------------------------------------------------------------
# Embedding serialisation helpers
# ---------------------------------------------------------------------------

def encode_embedding(values: list[float]) -> bytes:
    """Pack a list of floats into a raw float32 byte blob."""
    return struct.pack(f"{len(values)}f", *values)


def decode_embedding(blob: bytes) -> list[float]:
    """Unpack a float32 byte blob into a list of floats."""
    n = len(blob) // 4
    return list(struct.unpack(f"{n}f", blob))


# ---------------------------------------------------------------------------
# Municipality helpers
# ---------------------------------------------------------------------------

def upsert_municipality(
    conn: sqlite3.Connection,
    *,
    name: str,
    short_name: str,
    state: str | None = None,
    country: str = "US",
    youtube_channel_url: str | None = None,
    website_url: str | None = None,
) -> int:
    """Insert or ignore a municipality row, return its id."""
    conn.execute(
        """
        INSERT OR IGNORE INTO municipalities
            (name, short_name, state, country, youtube_channel_url, website_url)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (name, short_name, state, country, youtube_channel_url, website_url),
    )
    conn.commit()
    row = conn.execute(
        "SELECT id FROM municipalities WHERE short_name = ?", (short_name,)
    ).fetchone()
    return row["id"]


# ---------------------------------------------------------------------------
# Meeting helpers
# ---------------------------------------------------------------------------

def insert_meeting(
    conn: sqlite3.Connection,
    *,
    municipality_id: int,
    youtube_id: str,
    title: str,
    meeting_date: str | None = None,
    meeting_type: str | None = None,
    duration_secs: float | None = None,
    audio_path: str | None = None,
    transcript_path: str | None = None,
    status: str = "pending",
) -> int | None:
    """Insert a meeting row (skips if youtube_id already exists). Returns id or None."""
    cur = conn.execute(
        """
        INSERT OR IGNORE INTO meetings
            (municipality_id, youtube_id, title, meeting_date, meeting_type,
             duration_secs, audio_path, transcript_path, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            municipality_id, youtube_id, title, meeting_date, meeting_type,
            duration_secs, audio_path, transcript_path, status,
        ),
    )
    conn.commit()
    if cur.lastrowid and cur.rowcount > 0:
        return cur.lastrowid
    row = conn.execute(
        "SELECT id FROM meetings WHERE youtube_id = ?", (youtube_id,)
    ).fetchone()
    return row["id"] if row else None


def update_meeting_status(
    conn: sqlite3.Connection,
    meeting_id: int,
    status: str,
    *,
    error_message: str | None = None,
    audio_path: str | None = None,
    transcript_path: str | None = None,
    duration_secs: float | None = None,
) -> None:
    """Update a meeting's processing status and optional fields."""
    updates: list[str] = ["status = ?", "updated_at = datetime('now')"]
    params: list[Any] = [status]

    if error_message is not None:
        updates.append("error_message = ?")
        params.append(error_message)
    if audio_path is not None:
        updates.append("audio_path = ?")
        params.append(audio_path)
    if transcript_path is not None:
        updates.append("transcript_path = ?")
        params.append(transcript_path)
    if duration_secs is not None:
        updates.append("duration_secs = ?")
        params.append(duration_secs)

    params.append(meeting_id)
    conn.execute(f"UPDATE meetings SET {', '.join(updates)} WHERE id = ?", params)
    conn.commit()


def get_meeting_by_id(conn: sqlite3.Connection, meeting_id: int) -> sqlite3.Row | None:
    return conn.execute("SELECT * FROM meetings WHERE id = ?", (meeting_id,)).fetchone()


def get_meetings_by_status(conn: sqlite3.Connection, status: str) -> list[sqlite3.Row]:
    return conn.execute(
        "SELECT * FROM meetings WHERE status = ? ORDER BY meeting_date", (status,)
    ).fetchall()


# ---------------------------------------------------------------------------
# People helpers
# ---------------------------------------------------------------------------

def insert_person(
    conn: sqlite3.Connection,
    *,
    name: str,
    voice_embedding: list[float] | None = None,
) -> int:
    """Insert a new person and optionally their voice embedding."""
    blob = encode_embedding(voice_embedding) if voice_embedding else None
    sample_count = 1 if voice_embedding else 0
    cur = conn.execute(
        "INSERT INTO people (name, voice_embedding, voice_sample_count) VALUES (?, ?, ?)",
        (name, blob, sample_count),
    )
    person_id = cur.lastrowid
    assert person_id is not None

    if voice_embedding:
        conn.execute(
            "INSERT INTO vec_people (person_id, voice_embedding) VALUES (?, ?)",
            (person_id, encode_embedding(voice_embedding)),
        )

    conn.commit()
    return person_id


def update_person_embedding(
    conn: sqlite3.Connection,
    person_id: int,
    new_embedding: list[float],
) -> None:
    """Update a person's voice embedding using a running average."""
    row = conn.execute(
        "SELECT voice_embedding, voice_sample_count FROM people WHERE id = ?",
        (person_id,),
    ).fetchone()

    if row and row["voice_embedding"]:
        old_emb = decode_embedding(row["voice_embedding"])
        count = row["voice_sample_count"]
        avg_emb = [
            (old * count + new) / (count + 1)
            for old, new in zip(old_emb, new_embedding)
        ]
        new_count = count + 1
    else:
        avg_emb = new_embedding
        new_count = 1

    blob = encode_embedding(avg_emb)
    conn.execute(
        "UPDATE people SET voice_embedding = ?, voice_sample_count = ?, updated_at = datetime('now') WHERE id = ?",
        (blob, new_count, person_id),
    )
    # Upsert into vec_people
    conn.execute("DELETE FROM vec_people WHERE person_id = ?", (person_id,))
    conn.execute(
        "INSERT INTO vec_people (person_id, voice_embedding) VALUES (?, ?)",
        (person_id, encode_embedding(avg_emb)),
    )
    conn.commit()


def find_matching_person(
    conn: sqlite3.Connection,
    embedding: list[float],
    threshold: float = 0.4,
) -> int | None:
    """Return the person_id of the closest voice match, or None if below threshold."""
    rows = conn.execute(
        """
        SELECT person_id, distance FROM vec_people
        WHERE voice_embedding MATCH ?
          AND k = 1
        ORDER BY distance
        """,
        (encode_embedding(embedding),),
    ).fetchall()
    if rows and rows[0]["distance"] < threshold:
        return rows[0]["person_id"]
    return None


# ---------------------------------------------------------------------------
# Role helpers
# ---------------------------------------------------------------------------

def upsert_role(
    conn: sqlite3.Connection,
    *,
    person_id: int,
    municipality_id: int,
    role: str,
    title: str | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
) -> int:
    cur = conn.execute(
        """
        INSERT INTO roles (person_id, municipality_id, role, title, start_date, end_date)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (person_id, municipality_id, role, title, start_date, end_date),
    )
    conn.commit()
    return cur.lastrowid  # type: ignore[return-value]


# ---------------------------------------------------------------------------
# Segment helpers
# ---------------------------------------------------------------------------

def insert_segment(
    conn: sqlite3.Connection,
    *,
    meeting_id: int,
    text: str,
    start_time: float,
    end_time: float,
    person_id: int | None = None,
    speaker_label: str | None = None,
    agenda_item_id: int | None = None,
    confidence: float | None = None,
) -> int:
    cur = conn.execute(
        """
        INSERT INTO segments
            (meeting_id, agenda_item_id, person_id, speaker_label,
             text, start_time, end_time, confidence)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            meeting_id, agenda_item_id, person_id, speaker_label,
            text, start_time, end_time, confidence,
        ),
    )
    conn.commit()
    return cur.lastrowid  # type: ignore[return-value]


def insert_segment_embedding(
    conn: sqlite3.Connection,
    segment_id: int,
    embedding: list[float],
) -> None:
    """Insert or replace a segment's text embedding in vec_segments."""
    conn.execute("DELETE FROM vec_segments WHERE segment_id = ?", (segment_id,))
    conn.execute(
        "INSERT INTO vec_segments (segment_id, embedding) VALUES (?, ?)",
        (segment_id, encode_embedding(embedding)),
    )
    conn.commit()


def get_segments_missing_embeddings(
    conn: sqlite3.Connection, meeting_id: int
) -> list[sqlite3.Row]:
    """Return segments for a meeting that don't yet have a vec_segments entry."""
    return conn.execute(
        """
        SELECT s.id, s.text FROM segments s
        LEFT JOIN vec_segments vs ON vs.segment_id = s.id
        WHERE s.meeting_id = ? AND vs.segment_id IS NULL
        ORDER BY s.start_time
        """,
        (meeting_id,),
    ).fetchall()
