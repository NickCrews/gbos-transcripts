# GBOS Meeting Transcript Database

## Context

The Girdwood Board of Supervisors (GBOS) publishes meeting recordings on [YouTube](https://www.youtube.com/channel/UCOUlNInprZEjhbpVPiJOlEA) (~188 videos). There's no searchable archive of what was said, by whom, or when. This project creates an audio+transcript database with lexical and semantic search, a public JSON API, and a daily update pipeline — enabling citizens and AI agents to find when GBOS discussed any topic.

The data model is designed to be **municipality-agnostic** so additional government bodies can be added later, following the MeetingBank schema conventions where applicable.

## Prior Art Considered

- **Council Data Project**: Open-source, Python+TS, closest match — but uses Google Cloud services and Firebase
- **MeetingBank**: Research dataset covering 6 municipalities with agenda-item-linked transcripts. Our schema follows its structure: meetings contain agenda items, agenda items contain transcript segments with timing info
- **Hamlet / OpenCouncil / Councilmatic**: Production platforms, SaaS or tightly coupled to their own infra

## Tech Stack

| Component | Choice | Why |
|---|---|---|
| Download | `yt-dlp` | Best YouTube downloader, audio-only extraction |
| Transcription | `parakeet-mlx` (`mlx-community/parakeet-tdt-0.6b-v2`) | Fast on Apple Silicon via MLX, word+segment timestamps, simple pip install |
| Diarization | [`diarize`](https://github.com/FoxNoseTech/diarize) | Apache 2.0, no GPU/API keys needed, ~10.8% DER, 8x faster than realtime on CPU |
| Speaker embeddings | WeSpeaker ResNet34-LM (via `diarize` internals) | 256-dim voice fingerprints for cross-meeting speaker matching |
| Text embeddings | `sentence-transformers` (`all-MiniLM-L6-v2`, 384-dim) | Fast on CPU, small vectors, good quality for semantic search |
| Database | SQLite + FTS5 + `sqlite-vec` | Single-file, zero-ops, hybrid lexical+vector search |
| Pipeline | Python 3.13 via `uv` | All ML tooling is Python-native |
| API | TypeScript + Hono + Drizzle ORM (`better-sqlite3` driver) | Typed JSON API with type-safe queries, reads same SQLite file |
| Query embeddings | `@xenova/transformers` (ONNX in Node) | Encode search queries in JS, no Python sidecar needed |

## Project Structure

```
gbos/
├── pipeline/                   # Python (uv project)
│   ├── pyproject.toml
│   └── src/gbos_pipeline/
│       ├── config.py           # Paths, model names, channel URL
│       ├── db.py               # Schema creation + insert/query helpers
│       ├── download.py         # yt-dlp audio download
│       ├── transcribe.py       # Parakeet MLX transcription (timestamps)
│       ├── diarize_audio.py     # Diarization via `diarize` library + embedding extraction
│       ├── identify.py         # Cross-meeting speaker matching via voice embeddings
│       ├── align.py            # Merge transcription + diarization by timestamps
│       ├── embed.py            # Sentence-transformer text embedding
│       ├── ingest.py           # Pipeline orchestrator
│       ├── update.py           # Daily update CLI entry point
│       └── manage_people.py    # CLI for managing people/roles
│   └── tests/
│       ├── conftest.py         # Shared fixtures
│       ├── fixtures/           # Sample JSON outputs, embeddings
│       ├── test_download.py
│       ├── test_transcribe.py
│       ├── test_diarize.py
│       ├── test_align.py
│       ├── test_identify.py
│       ├── test_embed.py
│       └── test_ingest.py
├── api/                        # TypeScript (pnpm project)
│   ├── package.json
│   ├── tsconfig.json
│   ├── vitest.config.ts
│   ├── drizzle.config.ts
│   └── src/
│       ├── index.ts            # Hono app entry point
│       ├── db/
│       │   ├── connection.ts   # better-sqlite3 + drizzle instance
│       │   ├── schema.ts       # Drizzle schema (mirrors SQLite tables)
│       │   └── queries.ts      # Reusable query builders
│       ├── routes/
│       │   ├── meetings.ts     # GET /meetings, /meetings/:id
│       │   ├── search.ts       # GET /search (lexical/semantic/hybrid)
│       │   ├── people.ts       # GET /people, /people/:id
│       │   └── segments.ts     # GET /segments
│       └── __tests__/
│           ├── fixtures/       # Seed data + test DB factory
│           ├── meetings.test.ts
│           ├── search.test.ts
│           ├── people.test.ts
│           └── segments.test.ts
├── data/                       # gitignored
│   ├── audio/                  # WAV files (retained for audio clip API)
│   ├── gbos.db                 # SQLite database
│   └── transcripts/            # Raw JSON output (for reprocessing)
└── scripts/
    ├── setup.sh
    ├── backfill.sh
    └── daily-update.sh         # Cron wrapper
```

## Database Schema

Follows MeetingBank conventions: meetings → agenda items → segments. Extended with municipality support, people/roles split, and voice embeddings.

**Drizzle as source of truth**: The schema is defined in `api/src/db/schema.ts` using Drizzle ORM. The Python pipeline uses raw SQL but the schema creation SQL is generated from the Drizzle definitions via `drizzle-kit`. Both sides read/write the same `gbos.db` file.

```sql
------------------------------------------------------------
-- Multi-municipality support
------------------------------------------------------------
CREATE TABLE municipalities (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL,              -- "Girdwood Board of Supervisors"
    short_name    TEXT NOT NULL UNIQUE,       -- "gbos"
    state         TEXT,                       -- "AK"
    country       TEXT DEFAULT 'US',
    youtube_channel_url TEXT,
    website_url   TEXT,
    created_at    TEXT DEFAULT (datetime('now'))
);

------------------------------------------------------------
-- People and roles (split per user request)
------------------------------------------------------------
CREATE TABLE people (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL,
    voice_embedding BLOB,                    -- 256-dim float32 from WeSpeaker ResNet34-LM (via diarize)
    -- Aggregate embedding, updated as we see them in more meetings.
    -- Used for cross-meeting speaker matching.
    voice_sample_count INTEGER DEFAULT 0,    -- How many samples contributed to the embedding
    created_at    TEXT DEFAULT (datetime('now')),
    updated_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE roles (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    person_id     INTEGER NOT NULL REFERENCES people(id),
    municipality_id INTEGER NOT NULL REFERENCES municipalities(id),
    role          TEXT NOT NULL,              -- 'board_member', 'chair', 'vice_chair',
                                             -- 'staff', 'clerk', 'public', 'unknown'
    title         TEXT,                       -- "Board Member", "Fire Chief", etc.
    start_date    TEXT,                       -- ISO 8601
    end_date      TEXT,                       -- NULL if current
    created_at    TEXT DEFAULT (datetime('now'))
);

-- sqlite-vec virtual table for voice embedding similarity search
CREATE VIRTUAL TABLE vec_people USING vec0(
    person_id INTEGER PRIMARY KEY,
    voice_embedding float[256]
);

------------------------------------------------------------
-- Meetings (follows MeetingBank: one row per recording)
------------------------------------------------------------
CREATE TABLE meetings (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    municipality_id INTEGER NOT NULL REFERENCES municipalities(id),
    youtube_id      TEXT UNIQUE NOT NULL,
    title           TEXT NOT NULL,
    meeting_date    TEXT,                     -- ISO 8601 date (parsed from title)
    meeting_type    TEXT,                     -- 'regular', 'special', 'work_session',
                                             -- 'quarterly', 'joint'
    duration_secs   REAL,
    youtube_url     TEXT GENERATED ALWAYS AS
                    ('https://www.youtube.com/watch?v=' || youtube_id) STORED,
    audio_path      TEXT,                    -- Relative path to audio file
    transcript_path TEXT,                    -- Relative path to raw JSON
    status          TEXT DEFAULT 'pending',  -- pending → downloaded → transcribed
                                             -- → diarized → embedded → error
    error_message   TEXT,
    created_at      TEXT DEFAULT (datetime('now')),
    updated_at      TEXT DEFAULT (datetime('now'))
);

------------------------------------------------------------
-- Agenda items (follows MeetingBank itemInfo structure)
------------------------------------------------------------
CREATE TABLE agenda_items (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    meeting_id    INTEGER NOT NULL REFERENCES meetings(id),
    item_number   TEXT,                      -- "5a", "7", etc.
    title         TEXT NOT NULL,
    item_type     TEXT,                      -- 'ordinance', 'resolution', 'motion',
                                             -- 'discussion', 'public_hearing',
                                             -- 'consent', 'report', 'public_comment'
    start_time    REAL,                      -- Seconds from meeting start
    end_time      REAL,
    duration_secs REAL,
    created_at    TEXT DEFAULT (datetime('now'))
);

------------------------------------------------------------
-- Transcript segments (core unit, follows MeetingBank transcripts)
------------------------------------------------------------
CREATE TABLE segments (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    meeting_id      INTEGER NOT NULL REFERENCES meetings(id),
    agenda_item_id  INTEGER REFERENCES agenda_items(id),
    person_id       INTEGER REFERENCES people(id),
    speaker_label   TEXT,                    -- Raw diarization label (SPEAKER_00)
    text            TEXT NOT NULL,
    start_time      REAL NOT NULL,           -- Seconds from meeting start
    end_time        REAL NOT NULL,
    duration_secs   REAL GENERATED ALWAYS AS (end_time - start_time) STORED,
    confidence      REAL,
    created_at      TEXT DEFAULT (datetime('now'))
);

-- Full-text search (FTS5 with porter stemming)
CREATE VIRTUAL TABLE segments_fts USING fts5(
    text,
    content='segments',
    content_rowid='id',
    tokenize='porter unicode61'
);

-- Keep FTS in sync
CREATE TRIGGER segments_ai AFTER INSERT ON segments BEGIN
    INSERT INTO segments_fts(rowid, text) VALUES (new.id, new.text);
END;
CREATE TRIGGER segments_ad AFTER DELETE ON segments BEGIN
    INSERT INTO segments_fts(segments_fts, rowid, text)
    VALUES('delete', old.id, old.text);
END;
CREATE TRIGGER segments_au AFTER UPDATE OF text ON segments BEGIN
    INSERT INTO segments_fts(segments_fts, rowid, text)
    VALUES('delete', old.id, old.text);
    INSERT INTO segments_fts(rowid, text) VALUES (new.id, new.text);
END;

-- sqlite-vec for semantic search on transcript text
CREATE VIRTUAL TABLE vec_segments USING vec0(
    segment_id INTEGER PRIMARY KEY,
    embedding float[384]
);

------------------------------------------------------------
-- Meeting summaries (LLM-generated)
------------------------------------------------------------
CREATE TABLE summaries (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    meeting_id      INTEGER NOT NULL REFERENCES meetings(id),
    agenda_item_id  INTEGER REFERENCES agenda_items(id),
    summary_text    TEXT NOT NULL,
    model_used      TEXT,
    created_at      TEXT DEFAULT (datetime('now'))
);

------------------------------------------------------------
-- Topic alert subscriptions
------------------------------------------------------------
CREATE TABLE subscriptions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    query           TEXT NOT NULL,
    mode            TEXT DEFAULT 'hybrid',   -- 'lexical', 'semantic', 'hybrid'
    webhook_url     TEXT,
    email           TEXT,
    municipality_id INTEGER REFERENCES municipalities(id),  -- NULL = all
    created_at      TEXT DEFAULT (datetime('now')),
    last_notified_at TEXT
);

------------------------------------------------------------
-- Indexes
------------------------------------------------------------
CREATE INDEX idx_roles_person ON roles(person_id);
CREATE INDEX idx_roles_municipality ON roles(municipality_id);
CREATE INDEX idx_meetings_municipality ON meetings(municipality_id);
CREATE INDEX idx_meetings_date ON meetings(meeting_date);
CREATE INDEX idx_meetings_status ON meetings(status);
CREATE INDEX idx_agenda_items_meeting ON agenda_items(meeting_id);
CREATE INDEX idx_agenda_items_time ON agenda_items(meeting_id, start_time);
CREATE INDEX idx_segments_meeting ON segments(meeting_id);
CREATE INDEX idx_segments_person ON segments(person_id);
CREATE INDEX idx_segments_agenda ON segments(agenda_item_id);
CREATE INDEX idx_segments_time ON segments(meeting_id, start_time);
```

### How this maps to MeetingBank

| MeetingBank concept | Our schema |
|---|---|
| `MeetingID` (`CityName_Date`) | `municipalities.short_name` + `meetings.meeting_date` |
| `URLs.Video` | `meetings.youtube_url` |
| `VideoDuration` | `meetings.duration_secs` |
| `itemInfo` (agenda items with summary, type, start/end) | `agenda_items` table |
| `itemInfo.transcripts` (segments with offset, duration, text, confidence) | `segments` table |
| City-level grouping (Seattle, Denver, etc.) | `municipalities` table |

### What we add beyond MeetingBank

- **People + roles**: Persistent speaker identity across meetings with voice embeddings
- **Voice fingerprinting**: Automatic cross-meeting speaker linking
- **Semantic search**: Vector embeddings on transcript text
- **Summaries**: LLM-generated per meeting or agenda item
- **Subscriptions**: Topic alert system

## Cross-Meeting Speaker Identification

This is the key innovation beyond basic diarization. Instead of anonymous SPEAKER_00 labels per meeting, we build a persistent speaker database with voice fingerprints.

### How it works

1. **During diarization** (`diarize_audio.py`): The `diarize` library produces speaker turns with timing:
   ```python
   from diarize import diarize

   result = diarize("meeting.wav")
   for seg in result.segments:
       print(f"[{seg.start:.1f}s - {seg.end:.1f}s] {seg.speaker}")
   ```
   The library internally uses WeSpeaker ResNet34-LM (ONNX) to produce 256-dim speaker embeddings during its pipeline. We extract these embeddings per-speaker for cross-meeting matching.

2. **Extract voice embeddings** (`identify.py`): For each speaker label in the diarization result, we access the WeSpeaker embeddings that `diarize` already computed. The library's embedding extraction step produces 256-dim vectors per speech segment — we aggregate these per speaker (mean pooling over their segments) to get one voice fingerprint per speaker per meeting.

3. **Match against known people** (`identify.py`): Query `vec_people` for cosine similarity
   ```python
   # Search for matching voice in database
   # cosine similarity threshold: 0.6 (tunable)
   results = db.execute("""
       SELECT person_id, distance FROM vec_people
       WHERE voice_embedding MATCH ? AND distance < 0.4
       ORDER BY distance LIMIT 1
   """, [embedding_bytes])
   ```
   - **Match found (distance < 0.4, i.e. similarity > 0.6)**: Link segments to existing `person_id`, update their aggregate embedding with running average
   - **No match**: Create new `people` row with this embedding, store in `vec_people`. Name defaults to "Unknown Speaker N" until manually labeled.

4. **Update aggregate embedding**: As a person appears in more meetings, their voice fingerprint becomes more robust:
   ```python
   # Running average: new_avg = (old_avg * count + new_embedding) / (count + 1)
   new_embedding = (person.voice_embedding * person.voice_sample_count + embedding) / (count + 1)
   ```

5. **Manual override** (`manage_people.py`): CLI to merge duplicate people, assign names, set roles:
   ```bash
   uv run python -m gbos_pipeline.manage_people list           # Show all people
   uv run python -m gbos_pipeline.manage_people name 3 "Mike Edgington"
   uv run python -m gbos_pipeline.manage_people merge 3 7      # Merge person 7 into 3
   uv run python -m gbos_pipeline.manage_people role 3 gbos board_member --start 2023-01
   ```

### Why `diarize` over pyannote

- **Apache 2.0** — no HuggingFace token or account needed, fully permissive license
- **No GPU required** — runs 8x faster than realtime on CPU (a 2-hour meeting diarizes in ~15 min)
- **Simple API** — `diarize("file.wav")` returns segments, no pipeline configuration
- **~10.8% DER** — comparable to pyannote free tier (~11.2%), good enough for government meetings
- **WeSpeaker embeddings** — 256-dim vectors from the same pipeline, reusable for cross-meeting matching

### Why this works well for GBOS

- Meetings have ~5-7 recurring board members + a few staff → small, stable speaker set
- After 2-3 meetings, the system will reliably recognize regulars
- Public commenters get auto-created as new people; can be left unnamed or merged
- The threshold (0.6 cosine similarity) can be tuned per municipality

## Pipeline Stages (each idempotent)

1. **Discover + Download** (`download.py`): `yt-dlp --flat-playlist` → find new videos → download audio as WAV → insert meeting row → status=`downloaded`

2. **Transcribe** (`transcribe.py`): Parakeet MLX → sentence+word timestamps → save raw JSON → status=`transcribed`
   ```python
   from parakeet_mlx import from_pretrained
   model = from_pretrained("mlx-community/parakeet-tdt-0.6b-v2")
   result = model.transcribe("audio.wav")
   # result.sentences → [AlignedSentence(text="...", start=1.01, end=2.04, tokens=[...])]
   ```

3. **Diarize + Identify** (`diarize_audio.py` + `identify.py`): `diarize` library → speaker turns + WeSpeaker embeddings → match against `vec_people` → link or create people → status=`diarized`

4. **Align** (`align.py`): Merge Parakeet transcript segments with pyannote speaker turns by overlapping timestamps. Each segment gets assigned to the person who spoke during that window. Insert segments into DB.

5. **Embed** (`embed.py`): sentence-transformers encode segment texts → store in `vec_segments` → status=`embedded`

6. **Orchestrator** (`update.py`): Runs stages 1-5, skipping already-processed meetings

## API Endpoints

```
GET /api/v1/meetings?page=&limit=&type=&year=&after=&before=&municipality=
GET /api/v1/meetings/:id                    (includes agenda items, segment count, speakers)
GET /api/v1/meetings/:id/transcript?person=&from=&to=
GET /api/v1/meetings/:id/audio?from=&to=    (ffmpeg-sliced audio clip)

GET /api/v1/people?role=&municipality=
GET /api/v1/people/:id                      (includes roles, meeting count, total speaking time)
GET /api/v1/people/:id/segments?meeting_id=&page=&limit=

GET /api/v1/search?q=&mode=lexical|semantic|hybrid&meeting_id=&person_id=&year=&municipality=&limit=&page=
  → returns segments with meeting context, person info, score, and highlighted text

GET /api/v1/segments/:id/audio              (audio clip for a specific segment)

GET /api/v1/municipalities                  (list all municipalities)
```

**Hybrid search**: FTS5 (BM25) + sqlite-vec (cosine), normalize to [0,1], combine (0.6 semantic + 0.4 lexical), deduplicate, re-rank.

## Daily Update (Cron)

```
0 3 * * * /Users/nc/code/gbos/scripts/daily-update.sh
```

GBOS publishes ~2-4 meetings/month. Most runs find nothing new. New meeting processing: download (~5 min), transcribe (fast via MLX), diarize + identify (~minutes), embed (~seconds).

## Build Phases

1. **Foundation**: Init uv + pnpm projects, implement `db.py` (full schema), `download.py` (yt-dlp), test with 1 short meeting
2. **Transcription + Diarization + Speaker Matching**: Implement `transcribe.py` (parakeet-mlx), `diarize_audio.py` (`diarize` lib), `identify.py` (voice embedding matching via WeSpeaker), `align.py` (merge). No tokens/accounts needed. Test end-to-end on 2-3 meetings, verify speakers are linked across them.
3. **Embeddings + Search API**: Implement `embed.py`, FTS5 + sqlite-vec, build Hono API with search endpoints
4. **Audio Clips + People Management**: `GET /segments/:id/audio` via ffmpeg, `manage_people.py` CLI
5. **Daily Updates + Backfill**: `update.py` orchestrator, cron, then process all ~188 meetings
6. **Enhancements** (future): Agenda item population from MOA website, LLM meeting summaries, topic alerts, SRT/VTT export

## Verification

- **Pipeline**: Download + transcribe + diarize 1 short meeting, verify segments with speaker labels in DB
- **Speaker matching**: Process 2-3 meetings, verify that recurring board members are linked to the same `person_id` across meetings
- **Alignment**: Spot-check segments against actual video — verify text and speaker attribution
- **Search**: Query known phrases, compare lexical vs semantic results
- **API**: Test all endpoints with vitest
- **Audio clips**: Request a segment's audio, verify it plays the correct portion
- **Idempotency**: Run update twice, verify no duplicates
- **Multi-municipality**: Verify schema supports adding a second municipality without schema changes

## Key Dependencies

```
# pipeline/pyproject.toml
parakeet-mlx          # MLX-optimized transcription
diarize               # Speaker diarization (Apache 2.0, no GPU/tokens needed)
                      # Internally uses WeSpeaker ResNet34-LM for 256-dim embeddings
sentence-transformers # Text embedding generation
yt-dlp                # YouTube download
ffmpeg-python         # Audio slicing for clip API
sqlite-vec            # Vector search extension for SQLite

# api/package.json
hono                  # HTTP framework
drizzle-orm           # Type-safe ORM + query builder
better-sqlite3        # SQLite driver (used by drizzle)
drizzle-kit           # Schema tooling / migrations
@xenova/transformers  # Query embedding in JS (ONNX)
vitest                # Test runner
```

## Testing Architecture

### Principles

- **Real database, no mocks**: All tests use a real in-memory SQLite database with the full schema. This catches SQL issues that mocks would hide.
- **Fast feedback**: In-memory SQLite + vitest = sub-second test runs for the API. Python pipeline tests use a temporary DB file.
- **Fixture-based**: Shared seed data factories for creating test meetings, segments, people, etc.
- **Two test suites**: Python (pytest) for the pipeline, TypeScript (vitest) for the API.

### API Tests (TypeScript / vitest)

```
api/src/__tests__/
├── fixtures/
│   ├── db.ts               # createTestDb() → in-memory SQLite with full schema + seed data
│   ├── seed.ts              # Factory functions: createMeeting(), createPerson(), createSegment()
│   └── sample-embeddings.ts # Pre-computed 384-dim vectors for search tests
├── meetings.test.ts         # List, filter by date/type/municipality, get by ID
├── search.test.ts           # Lexical (FTS5), semantic (vec), hybrid, faceted filters
├── people.test.ts           # List, filter by role, get segments by person
└── segments.test.ts         # Get by meeting, time range, audio clip params
```

**Test DB factory** (`fixtures/db.ts`):
```typescript
import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import * as schema from '../../db/schema';

export function createTestDb() {
  const sqlite = new Database(':memory:');
  // Load sqlite-vec extension, create FTS5 tables, triggers
  const db = drizzle(sqlite, { schema });
  // Run schema creation
  // Seed with test data
  return db;
}
```

**What we test per endpoint**:
- Correct query results with known seed data
- Pagination (page/limit, total count)
- Filters (by date range, speaker, municipality, meeting type)
- Edge cases: empty results, invalid IDs, missing params
- Search ranking: known phrases rank higher than unrelated content
- Hybrid search: combining lexical + semantic returns better results than either alone

### Pipeline Tests (Python / pytest)

```
pipeline/tests/
├── conftest.py              # Shared fixtures: tmp_db, sample audio paths
├── test_download.py         # yt-dlp metadata parsing, deduplication logic
├── test_transcribe.py       # Parakeet output parsing (uses pre-recorded JSON fixtures, not live model)
├── test_diarize.py          # Diarization output parsing (uses pre-recorded fixtures)
├── test_align.py            # Timestamp merging: transcript segments + speaker turns → merged segments
├── test_identify.py         # Voice embedding matching: cosine similarity, threshold, merge logic
├── test_embed.py            # Text embedding insertion, vec_segments sync
├── test_ingest.py           # Full pipeline orchestration, status transitions, idempotency
└── fixtures/
    ├── sample_transcript.json   # Pre-recorded Parakeet output
    ├── sample_diarization.json  # Pre-recorded diarize output
    └── sample_embeddings.npy    # Pre-computed voice + text embeddings
```

**Key pipeline test strategies**:

- **Alignment tests** (`test_align.py`): The most logic-heavy unit. Test with known inputs:
  - Simple case: 1 speaker, segments map cleanly
  - Multi-speaker: segments split at speaker turn boundaries using word timestamps
  - Edge: speaker turn starts mid-word, overlapping turns
  - Use fixture JSON, not live models — this is pure logic

- **Identify tests** (`test_identify.py`): Test the matching logic:
  - Known person: embedding close to existing → links correctly
  - New person: embedding far from all existing → creates new entry
  - Running average: embedding updates correctly after N samples
  - Merge: two people merged, embeddings recalculated

- **Ingest/idempotency tests** (`test_ingest.py`): Run pipeline on same input twice, verify:
  - No duplicate meetings, segments, or people
  - Status transitions are correct
  - Error recovery: set a meeting to 'error', re-run, verify it retries

- **Download tests** (`test_download.py`): Mock yt-dlp subprocess output, test:
  - Title parsing → meeting_date, meeting_type extraction
  - Deduplication: existing youtube_id skipped
  - New video detected and queued

### Integration Test (end-to-end)

One integration test that runs the full pipeline on a short (~5 min) audio sample:
1. Download (or use a cached fixture audio file)
2. Transcribe with Parakeet
3. Diarize with `diarize`
4. Align + identify speakers
5. Embed text
6. Start Hono API against the resulting DB
7. Hit search endpoint, verify results include known content from the audio

This test is slow (~30s) and marked as `@pytest.mark.integration` / `vitest.skip` by default, run explicitly via `pytest -m integration` or a CI flag.

### CI Considerations

- **Fast tests** (< 5s): All unit tests for both pipeline and API — run on every push
- **Integration test** (~30s): Run on PR merge or nightly — requires the ML models to be cached
- **Backfill smoke test**: After processing a batch, run a health check script that verifies segment counts, FTS5 sync, and vec_segments completeness
