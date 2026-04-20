// One-time model download for sherpa-onnx diarization pipeline.
// Total ~45MB: Silero VAD (2MB) + pyannote-3.0 (6.6MB) + CAM++ (28MB) + configs.
//
// Run: pnpm download-models
//
// Models are saved to pipeline/models/ and loaded at runtime by diarize.ts.

import { mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";

const MODELS_DIR = new URL("../models", import.meta.url).pathname;
mkdirSync(MODELS_DIR, { recursive: true });

const models = [
  {
    name: "sherpa-onnx-pyannote-segmentation-3-0",
    url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2",
  },
  {
    name: "3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced",
    url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recog-models/3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.tar.bz2",
  },
  {
    name: "silero_vad",
    url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx",
    single_file: true,
  },
];

for (const model of models) {
  console.log(`Downloading ${model.name}...`);
  if ((model as any).single_file) {
    execSync(
      `curl -L -o "${join(MODELS_DIR, model.name + ".onnx")}" "${model.url}"`,
      { stdio: "inherit" },
    );
  } else {
    execSync(`curl -L "${model.url}" | tar -xj -C "${MODELS_DIR}"`, {
      stdio: "inherit",
    });
  }
  console.log(`  ✓ ${model.name}`);
}

console.log("\nAll models downloaded to", MODELS_DIR);
