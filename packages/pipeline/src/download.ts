import { execFileSync } from 'node:child_process';
import { execSync } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from './db.ts';

const AUDIO_DIR = process.env.AUDIO_DIR ?? './data/audio';
const CHANNEL_URL = 'https://www.youtube.com/channel/UCOUlNInprZEjhbpVPiJOlEA';

export async function discoverAndDownload(): Promise<void> {
  mkdirSync(AUDIO_DIR, { recursive: true });

  const raw = execSync(`yt-dlp --flat-playlist -J "${CHANNEL_URL}"`, {
    maxBuffer: 10 * 1024 * 1024,
  }).toString();
  const playlist = JSON.parse(raw);

  const [municipality] = await sql`
    INSERT INTO municipalities (name, name_short, state, youtube_channel_id)
    VALUES ('Girdwood Board of Supervisors', 'GBOS', 'AK', 'UCOUlNInprZEjhbpVPiJOlEA')
    ON CONFLICT (youtube_channel_id) DO UPDATE SET name = EXCLUDED.name
    RETURNING id
  `;

  for (const entry of playlist.entries as Array<{ id: string; title?: string }>) {
    const youtubeId = entry.id;
    const title = entry.title ?? '';

    const existing = await sql`SELECT id FROM meetings WHERE youtube_id = ${youtubeId}`;
    if (existing.length > 0) continue;

    const audioPath = join(AUDIO_DIR, `${youtubeId}.wav`);
    if (!existsSync(audioPath)) {
      execFileSync('yt-dlp', [
        '-x', '--audio-format', 'wav', '--audio-quality', '0',
        '-o', audioPath,
        `https://www.youtube.com/watch?v=${youtubeId}`,
      ]);
    }

    await sql`
      INSERT INTO meetings (municipality_id, youtube_id, title, status)
      VALUES (${municipality.id}, ${youtubeId}, ${title}, 'downloaded')
      ON CONFLICT (youtube_id) DO NOTHING
    `;

    console.log(`Downloaded: ${title} (${youtubeId})`);
  }
}
