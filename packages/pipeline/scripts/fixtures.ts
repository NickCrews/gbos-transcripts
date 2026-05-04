import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { loadAllFixtures } from "../src/test-utils/fixtures";
import { meetingCacheDir, isCached } from "../src/test-utils/audio-cache";

function status() {
  const fixtures = loadAllFixtures();
  if (fixtures.length === 0) {
    console.log("No fixtures found. Add a golden.json under packages/pipeline/test-fixtures/<municipality>/<meeting_id>/");
    return;
  }
  console.log(`${fixtures.length} fixture(s):`);
  for (const f of fixtures) {
    const dir = meetingCacheDir(f.meeting_id);
    const cached = isCached(f.meeting_id);
    const audioPath = join(dir, "audio.wav");
    let sizeNote = "";
    if (cached && existsSync(audioPath)) {
      const sz = statSync(audioPath).size;
      sizeNote = ` (${(sz / 1e9).toFixed(2)} GB)`;
    }
    const statusLabel = cached ? `cached${sizeNote}` : `would download from youtube:${f.golden.source.id}`;
    console.log(
      `  ${f.municipality}/${f.meeting_id}: ${statusLabel}\n    cache:  ${dir}\n    golden: ${f.fixtureDir}/golden.json (${f.golden.interesting_segments.length} segments)`,
    );
  }
}

const cmd = process.argv[2];
switch (cmd) {
  case "status":
  case undefined:
    status();
    break;
  default:
    console.error(`Unknown command: ${cmd}`);
    console.error("Usage: pnpm pipeline:fixtures status");
    process.exit(1);
}
