# GBOS Meeting Transcript Database

## Context

The Girdwood Board of Supervisors (GBOS) publishes meeting recordings on [YouTube](https://www.youtube.com/channel/UCOUlNInprZEjhbpVPiJOlEA) (~188 videos). There's no searchable archive of what was said, by whom, or when. This project creates an audio+transcript database with lexical and semantic search and a daily update pipeline — enabling citizens and AI agents to find when GBOS discussed any topic.

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
| Database | Postgres + pgvector + Drizzle ORM | |
| Pipeline | Python 3.13 via `uv` | All ML tooling is Python-native |
| Query embeddings | `@xenova/transformers` (ONNX in Node) | Encode search queries in JS, no Python sidecar needed |
| Web App | SolidJS + TanStack Start + TanStack Router | SSR-capable frontend with file-based routing, server functions |

**Drizzle as source of truth**: The schema is defined in `web/src/db/schema.ts` using Drizzle ORM. The Python pipeline uses raw SQL but the schema creation SQL is generated from the Drizzle definitions via `drizzle-kit`. Both sides connect to the same Postgres database.

### What we add beyond MeetingBank

- **People**: Persistent speaker identity across meetings with voice embeddings
- **Voice fingerprinting**: Automatic cross-meeting speaker linking

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
   # pgvector operator <=> is cosine distance
   results = db.execute("""
       SELECT person_id, (voice_embedding <=> %s) as distance 
       FROM vec_people
       WHERE voice_embedding <=> %s < 0.4
       ORDER BY distance LIMIT 1
   """, [embedding, embedding])
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

**Hybrid search**: Postgres Full Text Search (tsvector) + pgvector (cosine), normalize to [0,1], combine (0.6 semantic + 0.4 lexical), deduplicate, re-rank. Integrated directly into web app server functions.

## Daily Update (Cron)

```
0 3 * * * /Users/nc/code/gbos/scripts/daily-update.sh
```

GBOS publishes ~2-4 meetings/month. Most runs find nothing new. New meeting processing: download (~5 min), transcribe (fast via MLX), diarize + identify (~minutes), embed (~seconds).

## Build Phases

1. **Foundation**: Init uv + pnpm projects, implement `db.py` (full schema), `download.py` (yt-dlp), test with 1 short meeting
2. **Transcription + Diarization + Speaker Matching**: Implement `transcribe.py` (parakeet-mlx), `diarize_audio.py` (`diarize` lib), `identify.py` (voice embedding matching via WeSpeaker), `align.py` (merge). No tokens/accounts needed. Test end-to-end on 2-3 meetings, verify speakers are linked across them.
3. **Embeddings**: Implement `embed.py` to generate and store text embeddings
4. **Web App Foundation**: Build basic SolidJS + TanStack Start site with database connectivity
5. **Search + Detail Pages**: Implement hybrid search, meeting detail with transcript viewer, and people directory using TanStack Start server functions
6. **Audio Clips + People Management**: `ffmpeg`-based audio slicing, `manage_people.py` CLI
7. **Daily Updates + Backfill**: `update.py` orchestrator, cron, then process all ~188 meetings
8. **Enhancements** (future): Agenda item population from MOA website, LLM meeting summaries, topic alerts, SRT/VTT export

## Verification

- **Pipeline**: Download + transcribe + diarize 1 short meeting, verify segments with speaker labels in DB
- **Speaker matching**: Process 2-3 meetings, verify that recurring board members are linked to the same `person_id` across meetings
- **Alignment**: Spot-check segments against actual video — verify text and speaker attribution
- **Search**: Query known phrases, compare lexical vs semantic results in web app
- **Audio clips**: Request a segment's audio, verify it plays the correct portion
- **Idempotency**: Run update twice, verify no duplicates
- **Multi-municipality**: Verify schema supports adding a second municipality without schema changes
- **Web app**: Dev server starts, pages render, search returns results, navigation works between meetings/people/search

## Key Dependencies

```
# pipeline/pyproject.toml
parakeet-mlx          # MLX-optimized transcription
diarize               # Speaker diarization (Apache 2.0, no GPU/tokens needed)
                      # Internally uses WeSpeaker ResNet34-LM for 256-dim embeddings
sentence-transformers # Text embedding generation
yt-dlp                # YouTube download
ffmpeg-python         # Audio slicing for audio clipping
pgvector              # Vector search client for Postgres

# web/package.json
drizzle-orm           # Type-safe ORM + query builder
postgres              # postgres-js driver (used by drizzle)
drizzle-kit           # Schema tooling / migrations
vite-plugin-solid     # Vite integration for SolidJS
@tanstack/solid-start # TanStack Start framework for SolidJS
@tanstack/solid-router # File-based routing for SolidJS
solid-js              # UI framework
vite                  # Build tool
@xenova/transformers  # Query embedding in JS (ONNX)
vitest                # Test runner
```

## Testing Architecture

### Local Development Database

Postgres runs in Docker using the `pgvector/pgvector:pg17` image (which ships with pgvector pre-installed). A single command brings it up and applies all Drizzle migrations:

```bash
pnpm --filter gbos-web db:setup
# or from within web/
pnpm db:setup
```

This runs `docker compose up -d --wait` (waits for the health check to pass) then `drizzle-kit migrate`. The connection string for local dev is:

```
DATABASE_URL=postgres://postgres:postgres@localhost:5432/gbos
```

**Production**: swap `DATABASE_URL` for a cloud-hosted Postgres URL, e.g. [Neon](https://neon.tech). No other code changes are required — the same Drizzle migrations apply.

### Principles

- **Real database, no mocks**: All tests use a real Postgres database (Docker locally, Neon or equivalent in CI). This catches SQL issues that mocks would hide.
- **Fast feedback**: Vitest = sub-second test runs for the web app logic. Python pipeline tests use a dedicated test database.
- **Fixture-based**: Shared seed data factories for creating test meetings, segments, people, etc.
- **Two test suites**: Python (pytest) for the pipeline, TypeScript (vitest) for the web app.

### Web App Tests (TypeScript / vitest)

```
web/src/__tests__/
├── fixtures/
│   ├── db.ts               # createTestDb() → Test Postgres schema with full schema + seed data
│   ├── seed.ts              # Factory functions: createMeeting(), createPerson(), createSegment()
│   └── sample-embeddings.ts # Pre-computed 384-dim vectors for search tests
├── meetings.test.ts         # Server functions: List, filter by date/type/municipality, get by ID
├── search.test.ts           # Hybrid search logic (lexical + semantic)
├── people.test.ts           # Server functions: List, filter by role, get segments by person
└── segments.test.ts         # Server functions: Get by meeting, time range, audio clip params
```

**Test DB factory** (`fixtures/db.ts`):
```typescript
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../../db/schema';

export function createTestDb() {
  const queryClient = postgres("postgres://postgres:postgres@localhost:5432/gbos_test");
  const db = drizzle(queryClient, { schema });
  // Ensure pgvector extension and schema exist
  // Seed with test data
  return db;
}
```

**What we test**:
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
6. Start web app against the resulting DB
7. Call search server function, verify results include known content from the audio

This test is slow (~30s) and marked as `@pytest.mark.integration` / `vitest.skip` by default, run explicitly via `pytest -m integration` or a CI flag.

### CI Considerations

- **Fast tests** (< 5s): All unit tests for both pipeline and web app — run on every push
- **Integration test** (~30s): Run on PR merge or nightly — requires the ML models to be cached
- **Backfill smoke test**: After processing a batch, run a health check script that verifies segment counts, search index sync, and vec_segments completeness
