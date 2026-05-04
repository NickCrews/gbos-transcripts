import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import sherpa from "sherpa-onnx-node";
import { downloadVideoAudio } from "@gbos/core/youtube";
import { getMeetingFixture, type MeetingFixture } from "./fixtures";

const CACHE_ROOT = join(homedir(), ".cache", "gbos-transcripts", "meetings");

interface AudioManifest {
  meeting_id: number;
  source: { type: "youtube"; id: string };
  sha256: string;
  sample_rate: number;
  duration_sec: number;
}

export interface CachedAudio {
  path: string;
  manifest: AudioManifest;
}

export function meetingCacheDir(meeting_id: number): string {
  return join(CACHE_ROOT, String(meeting_id));
}

// Returns the cached path for `meeting_id`, downloading on miss and verifying
// the cached file's sha256 against the manifest. Throws if a stored manifest's
// sha doesn't match the file on disk, or if the manifest's sha doesn't match
// the golden's audio_sha256.
export async function getCachedAudio(meeting_id: number): Promise<CachedAudio> {
  const fixture = getMeetingFixture(meeting_id);
  return getCachedAudioForFixture(fixture);
}

export async function getCachedAudioForFixture(fixture: MeetingFixture): Promise<CachedAudio> {
  const dir = meetingCacheDir(fixture.meeting_id);
  const audioPath = join(dir, "audio.wav");
  const manifestPath = join(dir, "manifest.json");
  mkdirSync(dir, { recursive: true });

  if (existsSync(manifestPath) && existsSync(audioPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as AudioManifest;
    const actual = await sha256File(audioPath);
    if (actual !== manifest.sha256) {
      throw new Error(
        `Cached audio at ${audioPath} sha256 ${actual} does not match manifest ${manifest.sha256}; delete the cache directory to redownload.`,
      );
    }
    if (manifest.sha256 !== fixture.golden.audio_sha256) {
      throw new Error(
        `Cached audio sha256 ${manifest.sha256} does not match golden audio_sha256 ${fixture.golden.audio_sha256} for meeting ${fixture.meeting_id}.`,
      );
    }
    return { path: audioPath, manifest };
  }

  if (fixture.golden.source.type !== "youtube") {
    throw new Error(`Unsupported source type ${fixture.golden.source.type} for meeting ${fixture.meeting_id}`);
  }
  downloadVideoAudio(fixture.golden.source.id, audioPath, "skip");

  const sha256 = await sha256File(audioPath);
  if (sha256 !== fixture.golden.audio_sha256) {
    throw new Error(
      `Downloaded audio sha256 ${sha256} does not match golden audio_sha256 ${fixture.golden.audio_sha256} for meeting ${fixture.meeting_id}. Did the YouTube source change?`,
    );
  }

  const wave = sherpa.readWave(audioPath);
  const manifest: AudioManifest = {
    meeting_id: fixture.meeting_id,
    source: fixture.golden.source,
    sha256,
    sample_rate: wave.sampleRate,
    duration_sec: wave.samples.length / wave.sampleRate,
  };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return { path: audioPath, manifest };
}

export function isCached(meeting_id: number): boolean {
  const dir = meetingCacheDir(meeting_id);
  return existsSync(join(dir, "audio.wav")) && existsSync(join(dir, "manifest.json"));
}

async function sha256File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}
