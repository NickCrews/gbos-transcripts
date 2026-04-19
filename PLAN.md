# GBOS Meeting Transcript Database

## Context

The Girdwood Board of Supervisors (GBOS) publishes meeting recordings on [YouTube](https://www.youtube.com/channel/UCOUlNInprZEjhbpVPiJOlEA) (~188 videos). There's no searchable archive of what was said, by whom, or when. This project creates an audio+transcript database with lexical and semantic search and a daily update pipeline — enabling citizens and AI agents to find when GBOS discussed any topic.

The data model is designed to be **municipality-agnostic** so additional government bodies can be added later, following the MeetingBank schema conventions where applicable.

## Prior Art Considered

- **Council Data Project**: Open-source, Python+TS, closest match — but uses Google Cloud services and Firebase
- **MeetingBank**: Research dataset covering 6 municipalities with agenda-item-linked transcripts. Our schema follows its structure: meetings contain agenda items, agenda items contain transcript segments with timing info
- **Hamlet / OpenCouncil / Councilmatic**: Production platforms, SaaS or tightly coupled to their own infra
- **OpenWhispr**: Open-source meeting assistant using sherpa-onnx for local speaker diarization — our diarization pipeline follows their architecture

## Tech Stack

| Component | Choice | Why |
|---|---|---|
| Download | `yt-dlp` (CLI) | Best YouTube downloader, audio-only extraction |
| Transcription | `@xenova/transformers` (`Xenova/whisper-large-v3`) | Whisper via ONNX in Node.js, word-level timestamps, no Python |
| Diarization | `sherpa-onnx` | Native ONNX bindings, no Python/GPU, ~30s for 45-min meeting on M1 |
| Speaker embeddings | CAM++ via sherpa-onnx (512-dim) | Half the params of ECAPA-TDNN, lower EER, fast CPU inference, ONNX export |
| Text embeddings | `@xenova/transformers` (`Xenova/all-MiniLM-L6-v2`, 384-dim) | Same model as sentence-transformers, runs in Node.js via ONNX |
| Database | Postgres + pgvector + Drizzle ORM | |
| Pipeline | TypeScript + Node.js via `tsx`/`pnpm` | Unified stack — no Python sidecar, no runtime boundary |
| Web App | SolidJS + TanStack Start + TanStack Router | SSR-capable frontend with file-based routing, server functions |

**No Python required.** All ML runs through ONNX models loaded either by `sherpa-onnx` (diarization) or `@xenova/transformers` (transcription, text embedding). The only native dependency is `ffmpeg` for audio decoding.

**Drizzle as source of truth**: The schema is defined in `web/src/db/schema.ts`. The pipeline connects to the same Postgres database using `postgres` (postgres-js) with raw SQL.

### What we add beyond MeetingBank

- **People**: Persistent speaker identity across meetings with voice embeddings
- **Voice fingerprinting**: Automatic cross-meeting speaker linking via CAM++ 512-dim embeddings

## Diarization Architecture

Follows the [OpenWhispr local diarization approach](https://openwhispr.com/blog/local-speaker-diarization), implemented entirely through sherpa-onnx native Node.js bindings:

1. **Silero VAD** (~2MB) — filter silence before expensive stages
2. **pyannote-3.0 segmentation** (~6.6MB ONNX) — identify speaker boundaries and overlapping speech
3. **CAM++ embeddings** (~28MB ONNX) — 512-dim voice fingerprints per segment
4. **Agglomerative clustering** — group embeddings at 0.5 cosine-similarity threshold

Total model size: ~45MB, downloaded once via `pnpm download-models`. The only network activity after first launch is the one-time model download.

**Minimum segment duration**: 0.8 seconds for reliable CAM++ embedding extraction.

## Cross-Meeting Speaker Identification

Instead of anonymous `SPEAKER_00` labels per meeting, we maintain a persistent speaker database with voice fingerprints.

### How it works

1. **Diarization** (`pipeline/src/diarize.ts`): sherpa-onnx produces speaker turns + CAM++ 512-dim embeddings per speaker (mean-pooled over their segments).

2. **Identify** (`pipeline/src/identify.ts`): For each speaker embedding, query `people` by cosine distance:
   ```sql
   SELECT id FROM people
   WHERE voice_embedding <=> $vec::vector < 0.45  -- similarity > 0.55
   ORDER BY voice_embedding <=> $vec::vector
   LIMIT 1
   ```
   Confidence tiers (matching OpenWhispr):
   - **≥ 0.70 similarity**: auto-confirm
   - **0.55–0.70**: suggest (auto-confirm for now, can add UX prompt later)
   - **< 0.55**: create new `Unknown Speaker` row

3. **Link segments**: Each aligned transcript segment gets `person_id` set to the matched or newly-created person.

4. **Manual override** (future CLI): `tsx pipeline/src/manage-people.ts name 3 "Mike Edgington"`, merge duplicates, assign roles.

### Why this works well for GBOS

- Meetings have ~5-7 recurring board members + a few staff → small, stable speaker set
- After 2-3 meetings, the system will reliably recognize regulars
- Public commenters auto-created as new people; can be left unnamed or merged
- The threshold (0.55) is tunable per municipality

## Pipeline Stages (each idempotent)

Status tracked in `meetings.status` column:

1. **Discover + Download** (`download.ts`): `yt-dlp --flat-playlist` → find new videos → download audio as WAV → insert meeting row → `status='downloaded'`

2. **Transcribe** (`transcribe.ts`): `@xenova/transformers` Whisper → word+segment timestamps → saved to `meetings.transcription` (JSONB) → `status='transcribed'`

3. **Diarize** (`diarize.ts`): sherpa-onnx four-stage pipeline → speaker turns + CAM++ embeddings → saved to `meetings.diarization` (JSONB) → `status='diarized'`

4. **Align + Identify** (`align.ts` + `identify.ts`): merge Whisper segments with speaker turns by word-level timestamps → match embeddings against `people` → insert segments with `person_id` → `status='aligned'`

5. **Embed** (`embed.ts`): `@xenova/transformers` `all-MiniLM-L6-v2` → 384-dim text vectors → stored in `segments.text_embedding` → `status='embedded'`

6. **Orchestrator** (`update.ts`): runs stages 1–5, skipping already-processed meetings, resumable from any stage

**Hybrid search**: Postgres Full Text Search (tsvector) + pgvector cosine, normalized to [0,1], combined (0.6 semantic + 0.4 lexical). Integrated directly into web app server functions.

## Daily Update (Cron)

```
0 3 * * * cd /path/to/gbos-transcripts/pipeline && pnpm update
```

GBOS publishes ~2-4 meetings/month. Most runs find nothing new. New meeting processing: download (~5 min), transcribe (Whisper, varies by length), diarize (~30s for 45-min on M1), align+identify (~seconds), embed (~seconds).

## Build Phases

1. **Foundation**: Init pipeline pnpm project, implement `db.ts`, `download.ts`, test with 1 short meeting
2. **Transcription + Diarization**: Implement `transcribe.ts` (`@xenova/transformers` Whisper), `diarize.ts` (sherpa-onnx), `align.ts`. Download models (`pnpm download-models`). Test end-to-end on 2-3 meetings.
3. **Speaker Matching**: Implement `identify.ts`, verify speakers are linked across meetings
4. **Embeddings**: Implement `embed.ts` + add `text_embedding` column to segments
5. **Web App Foundation**: Build basic SolidJS + TanStack Start site with DB connectivity
6. **Search + Detail Pages**: Hybrid search, meeting detail with transcript viewer, people directory using TanStack Start server functions
7. **Audio Clips + People Management**: `ffmpeg`-based audio slicing, `manage-people.ts` CLI
8. **Daily Updates + Backfill**: `update.ts` orchestrator, cron, then process all ~188 meetings
9. **Enhancements** (future): Agenda item population from MOA website, LLM meeting summaries, topic alerts, SRT/VTT export

## Verification

- **Pipeline**: Download + transcribe + diarize 1 short meeting, verify segments with speaker labels in DB
- **Speaker matching**: Process 2-3 meetings, verify recurring board members link to the same `person_id`
- **Alignment**: Spot-check segments against actual video — verify text and speaker attribution
- **Search**: Query known phrases, compare lexical vs semantic results in web app
- **Idempotency**: Run `pnpm update` twice, verify no duplicates
- **Multi-municipality**: Verify schema supports adding a second municipality without schema changes
- **Web app**: Dev server starts, pages render, search returns results, navigation works

## Key Dependencies

```
# pipeline/package.json
sherpa-onnx              # Native ONNX bindings: VAD + pyannote segmentation + CAM++ + clustering
@xenova/transformers     # Whisper transcription + all-MiniLM-L6-v2 text embedding (ONNX in Node)
postgres                 # postgres-js driver
pgvector                 # Vector serialization helpers for postgres-js
dotenv                   # Environment variable loading

# External binaries (must be installed separately)
yt-dlp                   # YouTube download
ffmpeg                   # Audio decoding to 16kHz PCM (used by diarize.ts)

# pipeline/models/  (~45MB, downloaded via `pnpm download-models`, gitignored)
sherpa-onnx-pyannote-segmentation-3-0/model.onnx          # ~6.6MB
3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced/model.onnx  # ~28MB
silero_vad.onnx                                            # ~2MB

# web/package.json
drizzle-orm              # Type-safe ORM + query builder
postgres                 # postgres-js driver
drizzle-kit              # Schema tooling / migrations
vite-plugin-solid        # Vite integration for SolidJS
@tanstack/solid-start    # TanStack Start framework for SolidJS
@tanstack/solid-router   # File-based routing for SolidJS
solid-js                 # UI framework
vite                     # Build tool
@xenova/transformers     # Query embedding in JS (ONNX) — shared with pipeline
vitest                   # Test runner
```

## Testing Architecture

### Local Development Database

Postgres runs in Docker using the `pgvector/pgvector:pg17` image (which ships with pgvector pre-installed). A single command brings it up and applies all Drizzle migrations:

```bash
pnpm --filter gbos-web db:setup
# or from within web/
pnpm db:setup
```

This runs `docker compose up -d --wait` then `drizzle-kit migrate`. The connection string for local dev:

```
DATABASE_URL=postgres://postgres:postgres@localhost:5432/gbos
```

**Production**: swap `DATABASE_URL` for a cloud-hosted Postgres URL (e.g. Neon). No other code changes required.

### Principles

- **Real database, no mocks**: All tests use a real Postgres database (Docker locally, Neon in CI)
- **Fast feedback**: Vitest = sub-second test runs
- **Fixture-based**: Shared seed data factories for creating test meetings, segments, people
- **Single test suite**: TypeScript (vitest) for both pipeline logic and web app — no Python pytest

### Web App Tests (TypeScript / vitest)

```
web/src/__tests__/
├── fixtures/
│   ├── db.ts                 # createTestDb() → test Postgres instance
│   ├── seed.ts               # createMeeting(), createPerson(), createSegment()
│   └── sample-embeddings.ts  # Pre-computed 384-dim text vectors + 512-dim voice vectors
├── meetings.test.ts          # List, filter, get by ID
├── search.test.ts            # Hybrid search (lexical + semantic)
├── people.test.ts            # List, filter by role, get segments by person
└── segments.test.ts          # Get by meeting, time range, audio clip params
```

### Pipeline Tests (TypeScript / vitest)

```
pipeline/src/__tests__/
├── fixtures/
│   ├── sample_transcript.json    # Pre-recorded @xenova/transformers Whisper output
│   ├── sample_diarization.json   # Pre-recorded sherpa-onnx diarization output
│   └── sample_embeddings.json    # Pre-computed 512-dim CAM++ voice embeddings
├── align.test.ts             # Transcript + speaker turn merging (pure logic, no models)
├── identify.test.ts          # Cosine similarity matching, threshold, new person creation
└── update.test.ts            # Pipeline status transitions, idempotency
```

**Key pipeline test strategies**:

- **Alignment tests** (`align.test.ts`): Pure logic — no models. Test with known inputs:
  - Simple case: 1 speaker, segments map cleanly
  - Multi-speaker: word-level split at speaker turn boundaries
  - Edge: speaker turn starts mid-word, overlapping turns

- **Identify tests** (`identify.test.ts`): Test matching logic:
  - Known person: embedding close to existing → links correctly
  - New person: embedding far from all existing → creates new entry

- **Idempotency**: Run pipeline on same input twice, verify no duplicate meetings/segments/people

### Integration Test (end-to-end)

One integration test that runs the full pipeline on a short (~5 min) audio sample using real models:
1. Transcribe with `@xenova/transformers` Whisper
2. Diarize with sherpa-onnx
3. Align + identify speakers
4. Embed text
5. Call search server function, verify results include known content

Marked `vitest.skip` by default, run explicitly via `INTEGRATION=1 vitest run`.

### CI Considerations

- **Fast tests** (< 5s): All unit tests — run on every push
- **Integration test** (~30s): Run on PR merge or nightly — requires models cached
- **Backfill smoke test**: After processing a batch, verify segment counts and search index sync
