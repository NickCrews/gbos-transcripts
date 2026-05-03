import { join, resolve, dirname } from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from 'node:url';

import sherpa_onnx from 'sherpa-onnx-node';

const HERE = new URL(".", import.meta.url);

// Notes:
// This model only says it works up to 3 hours. At least one meeitng is 2:45. I bet others will be too long.
// This also seems to use a lot of memory, and is pretty slow. Not sure why, it is supposed to be quite fast.
// Perhaps we should switch to this other model which is much newer and supports streaming,
// so I think the length of the video should be irrelevant:
// https://huggingface.co/nvidia/parakeet-unified-en-0.6b/discussions/4

export async function transcribeAudio(audioPath: string) {
  const downloadDir = join(HERE.pathname, "models", "sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8");
  getModelFiles(downloadDir);
  const config = {
    'featConfig': {
      'sampleRate': 16000,
      'featureDim': 80,
    },
    'modelConfig': {
      'transducer': {
        'encoder': join(downloadDir, 'encoder.int8.onnx'),
        'decoder': join(downloadDir, 'decoder.int8.onnx'),
        'joiner': join(downloadDir, 'joiner.int8.onnx'),
      },
      'tokens': join(downloadDir, 'tokens.txt'),
      'numThreads': 2,
      'provider': 'cpu',
      'debug': 1,
      'modelType': 'nemo_transducer',
    }
  };

  const recognizer = new sherpa_onnx.OfflineRecognizer(config);
  console.log('Started');
  const start = Date.now();
  const stream = recognizer.createStream();
  const wave = sherpa_onnx.readWave(audioPath);
  stream.acceptWaveform({ sampleRate: wave.sampleRate, samples: wave.samples });

  recognizer.decode(stream);
  const result = recognizer.getResult(stream);
  const stop = Date.now();
  console.log('Done');

  const elapsed_seconds = (stop - start) / 1000;
  const duration = wave.samples.length / wave.sampleRate;
  const real_time_factor = elapsed_seconds / duration;
  console.log('Wave duration', duration.toFixed(3), 'seconds');
  console.log('Elapsed', elapsed_seconds.toFixed(3), 'seconds');
  console.log(
    `RTF = ${elapsed_seconds.toFixed(3)}/${duration.toFixed(3)} =`,
    real_time_factor.toFixed(3));
  console.log(audioPath);
  console.log('result\n', result);
  return result;
}

function getModelFiles(downloadDir: string) {
  // Please download test files from
  // https://github.com/k2-fsa/sherpa-onnx/releases/tag/asr-models
  const url = "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8.tar.bz2";
  if (!existsSync(downloadDir)) {
    console.log(`Downloading model files from ${url} to ${downloadDir}...`);
    mkdirSync(downloadDir, { recursive: true });
    const parentDir = dirname(downloadDir);
    execSync(`curl -L "${url}" | tar -xj -C "${parentDir}"`, {
      stdio: "inherit",
    });
    console.log(`Model files downloaded and extracted to ${downloadDir}.`);
  } else {
    console.log(`Model files already exist, skipping download to ${downloadDir}.`);
  }
}

async function cli() {
  const audioPath = process.argv[2];
  if (!audioPath) {
    console.error("Usage: node transcribe.js <path-to-audio-file>");
    process.exit(1);
  }
  const result = await transcribeAudio(audioPath);
  console.log("Transcription result:", result);
}

const isDirectRun = process.argv[1] !== undefined
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  cli();
}