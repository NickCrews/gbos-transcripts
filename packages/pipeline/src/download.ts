import { execFileSync, execSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { db, meetingsTable, municipalitiesTable } from "@gbos/db";

const AUDIO_DIR = process.env.AUDIO_DIR ?? "./data/audio";
const CHANNEL_ID = "UCOUlNInprZEjhbpVPiJOlEA";
const CHANNEL_URL = `https://www.youtube.com/channel/${CHANNEL_ID}`;

export async function discoverNewVideos() {
  const raw = execSync(`yt-dlp --flat-playlist -J "${CHANNEL_URL}"`, {
    maxBuffer: 10 * 1024 * 1024,
  }).toString();
  const playlist = JSON.parse(raw) as {
    entries: Array<{
      id: string;
      title?: string;
    }>;
  };

  const municipality = await getOrCreateMunicipality();

  for (const entry of playlist.entries) {
    const youtubeId = entry.id;
    const title = entry.title ?? "";

    const [existing] = await db
      .select({ id: meetingsTable.id })
      .from(meetingsTable)
      .where(eq(meetingsTable.youtube_id, youtubeId))
      .limit(1);
    if (existing) continue;

    await db.insert(meetingsTable).values({
      municipality_id: municipality.id,
      youtube_id: youtubeId,
      title,
      status: "discovered",
    });

    console.log(`Discovered: ${title} (${youtubeId})`);
  }
}

export function downloadAudio(youtubeId: string) {
  mkdirSync(AUDIO_DIR, { recursive: true });
  const audioPath = join(AUDIO_DIR, `${youtubeId}.wav`);
  if (!existsSync(audioPath)) {
    execFileSync("yt-dlp", [
      "-x",
      "--audio-format",
      "wav",
      "--audio-quality",
      "0",
      "-o",
      audioPath,
      `https://www.youtube.com/watch?v=${youtubeId}`,
    ]);
  }
  return audioPath;
}

async function getOrCreateMunicipality() {
  const [existing] = await db
    .select({ id: municipalitiesTable.id })
    .from(municipalitiesTable)
    .where(eq(municipalitiesTable.youtube_channel_id, CHANNEL_ID))
    .limit(1);
  if (existing) return existing;

  const [created] = await db
    .insert(municipalitiesTable)
    .values({
      name: "Girdwood Board of Supervisors",
      name_short: "GBOS",
      state: "AK",
      youtube_channel_id: CHANNEL_ID,
    })
    .returning({ id: municipalitiesTable.id });
  return created!;
}
