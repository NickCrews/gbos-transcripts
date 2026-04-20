import "dotenv/config";
import { join } from "node:path";
import { sql } from "./db.ts";
import { discoverAndDownload } from "./download.ts";
import { transcribeAudio } from "./transcribe.ts";
import { diarizeAudio } from "./diarize.ts";
import { alignTranscriptWithSpeakers } from "./align.ts";
import { identifyAndInsertSegments } from "./identify.ts";
import { embedSegments } from "./embed.ts";

const AUDIO_DIR = process.env.AUDIO_DIR ?? "./data/audio";

async function run() {
  console.log("=== GBOS Pipeline ===");

  // Stage 1: discover new videos and download audio
  await discoverAndDownload();

  // Stages 2–5: process each downloaded-but-not-yet-embedded meeting
  const pending = await sql<
    Array<{ id: number; youtube_id: string; status: string }>
  >`
    SELECT id, youtube_id, status
    FROM meetings
    WHERE status IN ('downloaded', 'transcribed', 'diarized', 'aligned')
    ORDER BY id
  `;

  for (const meeting of pending) {
    const audioPath = join(AUDIO_DIR, `${meeting.youtube_id}.wav`);
    console.log(
      `\nProcessing meeting ${meeting.id} (${meeting.youtube_id}) — status: ${meeting.status}`,
    );

    try {
      if (meeting.status === "downloaded") {
        console.log("  Transcribing...");
        const transcript = await transcribeAudio(audioPath);
        await sql`
          UPDATE meetings SET transcription = ${JSON.stringify(transcript)}, status = 'transcribed'
          WHERE id = ${meeting.id}
        `;
        meeting.status = "transcribed";
      }

      if (meeting.status === "transcribed") {
        console.log("  Diarizing...");
        const { turns, speakerEmbeddings } = await diarizeAudio(audioPath);
        await sql`
          UPDATE meetings SET diarization = ${JSON.stringify(turns)}, status = 'diarized'
          WHERE id = ${meeting.id}
        `;
        meeting.status = "diarized";
        // Store embeddings in a temp JS map for the align step below
        (meeting as any)._turns = turns;
        (meeting as any)._embeddings = speakerEmbeddings;
      }

      if (meeting.status === "diarized") {
        console.log("  Aligning and identifying speakers...");
        const row = await sql<
          Array<{ transcription: string; diarization: string }>
        >`
          SELECT transcription, diarization FROM meetings WHERE id = ${meeting.id}
        `;
        const transcript = JSON.parse(row[0].transcription);
        const turns = JSON.parse(row[0].diarization);
        // Re-diarize to get embeddings if not already in memory
        const { speakerEmbeddings } = (meeting as any)._embeddings
          ? { speakerEmbeddings: (meeting as any)._embeddings }
          : await diarizeAudio(audioPath);

        const aligned = alignTranscriptWithSpeakers(transcript, turns);
        await identifyAndInsertSegments(meeting.id, aligned, speakerEmbeddings);
        await sql`UPDATE meetings SET status = 'aligned' WHERE id = ${meeting.id}`;
        meeting.status = "aligned";
      }

      if (meeting.status === "aligned") {
        console.log("  Embedding segments...");
        await embedSegments(meeting.id);
        await sql`UPDATE meetings SET status = 'embedded' WHERE id = ${meeting.id}`;
      }

      console.log(`  ✓ Done: ${meeting.youtube_id}`);
    } catch (err) {
      console.error(`  ✗ Failed: ${err}`);
      await sql`UPDATE meetings SET status = 'error' WHERE id = ${meeting.id}`;
    }
  }

  await sql.end();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
