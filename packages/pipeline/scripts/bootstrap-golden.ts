// One-shot helper: slice the cached audio at a few time windows and print
// what sherpa transcribes for each. Use the output as a STARTING POINT for
// hand-curating golden.json — listen to the audio and correct text + speaker
// before committing.
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { transcribeSamples } from "../src/transcribe";
import { readWave, sliceWave } from "../src/test-utils/wav-window";

async function main() {
  const audioPath = process.argv[2];
  const windowsArg = process.argv.slice(3);
  if (!audioPath || windowsArg.length === 0) {
    console.error("Usage: tsx bootstrap-golden.ts <audio.wav> <start-end> [<start-end> ...]");
    console.error("Example: tsx bootstrap-golden.ts audio.wav 60-90 600-630");
    process.exit(1);
  }
  const wave = readWave(audioPath);
  console.error(
    `loaded ${audioPath}: ${wave.sampleRate} Hz, ${(wave.samples.length / wave.sampleRate).toFixed(1)}s`,
  );
  const out = [];
  for (const w of windowsArg) {
    const [a, b] = w.split("-").map((s) => Number(s));
    if (!Number.isFinite(a) || !Number.isFinite(b) || (a as number) >= (b as number)) {
      throw new Error(`Bad window ${w}, expected start-end in seconds`);
    }
    const start = a as number;
    const end = b as number;
    const slice = sliceWave(wave, start, end);
    const t0 = Date.now();
    const result = transcribeSamples(slice.samples, slice.sampleRate);
    const elapsed = (Date.now() - t0) / 1000;
    console.error(`[${start}-${end}] ${elapsed.toFixed(1)}s -> ${result.text}`);
    out.push({ start, end, text: result.text, timestamps: result.timestamps });
  }
  console.log(JSON.stringify(out, null, 2));
}

const isDirectRun =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) main();
