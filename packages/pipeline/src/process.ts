import { join } from "node:path";
import { eq, inArray } from "drizzle-orm";
import { type DB, getDb, meetingsTable, MeetingStatus } from "@gbos/core/db";
import { getOrCreateGbos } from "@gbos/core/munis";
import { downloadVideoAudio, videosInChannel } from "@gbos/core/youtube";
import { transcribeAudio } from "./transcribe";
import { diarizeAudio } from "./diarize";
import { alignTranscriptWithSpeakers } from "./align";
import { identifyAndInsertSegments } from "./identify";
import { embedSegments } from "./embed";
import type { DiarizationTurn, TranscriptSegment } from "./types";
import { loadEnv } from "./env";

const AUDIO_DIR = process.env.AUDIO_DIR ?? "./data/audio";

export async function addNewVideos(db: DB) {
  const muni = await getOrCreateGbos(db);
  const ytVideos = videosInChannel(muni.youtube_channel_id);
  // insert any new videos we haven't seen before, so that they get processed in this run
  const dbMeetings = ytVideos.map((entry) => ({
    municipality_id: muni.id,
    youtube_id: entry.id,
    title: entry.title ?? `Untitled video ${entry.id}`,
    status: "discovered" as const,
  }));
  await db.insert(meetingsTable).values(dbMeetings).onConflictDoNothing({
    target: meetingsTable.youtube_id,
  });
}

export async function getMeetingTodos(db: DB) {
  const todos = await db
    .select({
      id: meetingsTable.id,
      youtube_id: meetingsTable.youtube_id,
      status: meetingsTable.status,
    })
    .from(meetingsTable)
    .where(
      inArray(meetingsTable.status, [
        "discovered",
        "downloaded",
        "transcribed",
        "diarized",
        "aligned",
      ]),
    )
    .orderBy(meetingsTable.id);
  return todos;
}

export async function processOneMeeting(db: DB, meeting: { id: number; youtube_id: string; status: MeetingStatus }) {
  const audioPath = join(AUDIO_DIR, `${meeting.youtube_id}.wav`);
  console.log(
    `\nProcessing meeting ${meeting.id} (${meeting.youtube_id}) — status: ${meeting.status}`,
  );
  // Carry diarization output across stages within this run so we don't
  // have to redo the work to recover speaker embeddings.
  let speakerEmbeddings: Map<number, Float32Array> | undefined;

  if (meeting.status === "discovered") {
    console.log("  Downloading...");
    downloadVideoAudio(meeting.youtube_id, audioPath);
    await db
      .update(meetingsTable)
      .set({ status: "downloaded" })
      .where(eq(meetingsTable.id, meeting.id));
    meeting.status = "downloaded";
  }

  if (meeting.status === "downloaded") {
    console.log("  Transcribing...");
    const transcript = await transcribeAudio(audioPath);
    await db
      .update(meetingsTable)
      .set({ transcription: transcript, status: "transcribed" })
      .where(eq(meetingsTable.id, meeting.id));
    meeting.status = "transcribed";
  }

  if (meeting.status === "transcribed") {
    console.log("  Diarizing...");
    const result = await diarizeAudio(audioPath);
    speakerEmbeddings = result.speakerEmbeddings;
    await db
      .update(meetingsTable)
      .set({ diarization: result.turns, status: "diarized" })
      .where(eq(meetingsTable.id, meeting.id));
    meeting.status = "diarized";
  }

  if (meeting.status === "diarized") {
    console.log("  Aligning and identifying speakers...");
    const [row] = await db
      .select({
        transcription: meetingsTable.transcription,
        diarization: meetingsTable.diarization,
      })
      .from(meetingsTable)
      .where(eq(meetingsTable.id, meeting.id));
    speakerEmbeddings ??= (await diarizeAudio(audioPath)).speakerEmbeddings;

    const aligned = alignTranscriptWithSpeakers(
      row!.transcription as TranscriptSegment[],
      row!.diarization as DiarizationTurn[],
    );
    await identifyAndInsertSegments(db, meeting.id, aligned, speakerEmbeddings);
    await db
      .update(meetingsTable)
      .set({ status: "aligned" })
      .where(eq(meetingsTable.id, meeting.id));
    meeting.status = "aligned";
  }

  if (meeting.status === "aligned") {
    console.log("  Embedding segments...");
    await embedSegments(db, meeting.id);
    await db
      .update(meetingsTable)
      .set({ status: "embedded" })
      .where(eq(meetingsTable.id, meeting.id));
  }
  console.log(`  ✓ Done: ${meeting.youtube_id}`);
}

async function main() {
  loadEnv();
  const { db, client } = getDb();
  console.log("=== GBOS Pipeline ===");
  try {
    await addNewVideos(db);
    const todos = await getMeetingTodos(db);
    for (const todo of todos) {
      await processOneMeeting(db, todo);
    }
    await client.end();
  } catch (err) {
    console.error(`  ✗ Failed: ${err}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
