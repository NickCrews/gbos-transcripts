import { eq } from "drizzle-orm";
import { type DB, meetingsTable } from "@gbos/core/db";
import { videosInChannel } from "@gbos/core/youtube";

export async function discoverNewVideos({ muni_id, youtube_channel_id, db }: { muni_id: number, youtube_channel_id: string, db: DB }) {
  const entries = videosInChannel(youtube_channel_id);
  for (const entry of entries) {
    const youtubeId = entry.id;
    const title = entry.title ?? "";

    const [existing] = await db
      .select({ id: meetingsTable.id })
      .from(meetingsTable)
      .where(eq(meetingsTable.youtube_id, youtubeId))
      .limit(1);
    if (existing) continue;

    await db.insert(meetingsTable).values({
      municipality_id: muni_id,
      youtube_id: youtubeId,
      title,
      status: "discovered",
    });

    console.log(`Discovered: ${title} (${youtubeId})`);
  }
}