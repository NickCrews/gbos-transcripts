import { join } from "node:path";
import { eq, inArray } from "drizzle-orm";
import { getDb, meetingsTable } from "@gbos/core/db";
import { getOrCreateGbos } from "@gbos/core/munis";
import { downloadVideoAudio } from "@gbos/core/youtube";
import { discoverNewVideos } from "./download";
import { transcribeAudio } from "./transcribe";
import { diarizeAudio } from "./diarize";
import { alignTranscriptWithSpeakers } from "./align";
import { identifyAndInsertSegments } from "./identify";
import { embedSegments } from "./embed";
import type { DiarizationTurn, TranscriptSegment } from "./types";
import { loadEnv } from "./env";

const AUDIO_DIR = process.env.AUDIO_DIR ?? "./data/audio";

async function run() {
  console.log("=== GBOS Pipeline ===");
  const env = loadEnv();
  const { db, client } = getDb(env.DATABASE_URL);

  const muni = await getOrCreateGbos(db);

  // Stage 1: discover new videos
  await discoverNewVideos({
    muni_id: muni.id,
    youtube_channel_id: muni.youtube_channel_id,
    db,
  });

  // Stages 2–6: process each meeting
  const pending = await db
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

  for (const meeting of pending) {
    const audioPath = join(AUDIO_DIR, `${meeting.youtube_id}.wav`);
    console.log(
      `\nProcessing meeting ${meeting.id} (${meeting.youtube_id}) — status: ${meeting.status}`,
    );

    try {
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
    } catch (err) {
      console.error(`  ✗ Failed: ${err}`);
      await db
        .update(meetingsTable)
        .set({ status: "error" })
        .where(eq(meetingsTable.id, meeting.id));
    }
  }

  await client.end();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
