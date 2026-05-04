import { join, resolve, dirname } from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import sherpa_onnx, { type OfflineRecognizer, type OfflineRecognizerResult } from "sherpa-onnx-node";

const HERE = new URL(".", import.meta.url);
const MODEL_DIR = join(HERE.pathname, "models", "sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8");
const MODEL_URL =
  "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8.tar.bz2";

let _recognizer: OfflineRecognizer | null = null;

export function getRecognizer(): OfflineRecognizer {
  if (_recognizer) return _recognizer;
  ensureModelFiles(MODEL_DIR);
  _recognizer = new sherpa_onnx.OfflineRecognizer({
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig: {
      transducer: {
        encoder: join(MODEL_DIR, "encoder.int8.onnx"),
        decoder: join(MODEL_DIR, "decoder.int8.onnx"),
        joiner: join(MODEL_DIR, "joiner.int8.onnx"),
      },
      tokens: join(MODEL_DIR, "tokens.txt"),
      numThreads: 2,
      provider: "cpu",
      debug: 0,
      modelType: "nemo_transducer",
    },
  });
  return _recognizer;
}

export function transcribeSamples(
  samples: Float32Array,
  sampleRate: number,
): OfflineRecognizerResult {
  const recognizer = getRecognizer();
  const stream = recognizer.createStream();
  stream.acceptWaveform({ sampleRate, samples });
  recognizer.decode(stream);
  return recognizer.getResult(stream);
}

export async function transcribeAudio(audioPath: string) {
  const start = Date.now();
  const wave = sherpa_onnx.readWave(audioPath);
  const result = transcribeSamples(wave.samples, wave.sampleRate);
  const elapsed = (Date.now() - start) / 1000;
  const duration = wave.samples.length / wave.sampleRate;
  console.log(
    `transcribed ${audioPath}: ${duration.toFixed(1)}s audio in ${elapsed.toFixed(1)}s (RTF=${(elapsed / duration).toFixed(2)})`,
  );
  return result;
}

function ensureModelFiles(downloadDir: string) {
  if (existsSync(downloadDir)) return;
  console.log(`Downloading model files from ${MODEL_URL} to ${downloadDir}...`);
  mkdirSync(downloadDir, { recursive: true });
  execSync(`curl -L "${MODEL_URL}" | tar -xj -C "${dirname(downloadDir)}"`, {
    stdio: "inherit",
  });
}

async function cli() {
  const audioPath = process.argv[2];
  if (!audioPath) {
    console.error("Usage: tsx transcribe.ts <path-to-audio-file>");
    process.exit(1);
  }
  const result = await transcribeAudio(audioPath);
  console.log("Transcription result:", result);
}

const isDirectRun =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  cli();
}
