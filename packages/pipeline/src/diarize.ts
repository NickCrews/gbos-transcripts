import { execSync } from "node:child_process";
import { join } from "node:path";
import type { DiarizationTurn } from "./types.ts";

// Four-stage pipeline following OpenWhispr's local diarization architecture:
//   1. Silero VAD     — filter silence before expensive stages (~2MB model)
//   2. pyannote-3.0   — identify speaker boundaries + overlaps (~6.6MB ONNX)
//   3. CAM++          — 512-dim voice embeddings, half the params of ECAPA-TDNN (~28MB ONNX)
//   4. Agglomerative clustering — group embeddings at 0.5 cosine-similarity threshold
//
// sherpa-onnx runs natively via Node.js bindings — no Python, no GPU required.
// Processing: ~30s for a 45-min meeting on M1 Mac.

const MODELS_DIR = new URL("../models", import.meta.url).pathname;
const SAMPLE_RATE = 16000;
const MIN_SEGMENT_SECS = 0.8; // below this, CAM++ embeddings are unreliable
const EMBEDDING_DIM = 512;

export interface DiarizationResult {
  turns: DiarizationTurn[];
  speakerEmbeddings: Map<number, Float32Array>; // local speaker id → 512-dim CAM++ fingerprint
}

export async function diarizeAudio(
  audioPath: string,
): Promise<DiarizationResult> {
  const sherpa = await import("sherpa-onnx");

  // Stages 1–4: VAD → segmentation → embedding → clustering (all within OfflineSpeakerDiarization)
  const sd = new sherpa.OfflineSpeakerDiarization({
    segmentation: {
      pyannote: {
        model: join(
          MODELS_DIR,
          "sherpa-onnx-pyannote-segmentation-3-0/model.onnx",
        ),
      },
    },
    embedding: {
      model: join(
        MODELS_DIR,
        "3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced/model.onnx",
      ),
      numThreads: 1,
    },
    clustering: {
      type: 1, // AgglomerativeClustering
      agglomerativeClustering: {
        threshold: 0.5,
        minNumSpeakers: 0,
        maxNumSpeakers: 20,
      },
    },
    minDurationOn: MIN_SEGMENT_SECS,
    minDurationOff: 0.5,
    numThreads: 4,
  });

  const samples = loadAudioAt16kHz(audioPath);
  const sdResult = sd.process(samples);

  const turns: DiarizationTurn[] = sdResult.segments.map(
    (s: { start: number; end: number; speaker: number }) => ({
      start: s.start,
      end: s.end,
      speaker: s.speaker,
    }),
  );

  // Extract per-speaker voice fingerprints via CAM++ (512-dim, mean-pooled over segments)
  const extractor = new sherpa.SpeakerEmbeddingExtractor({
    model: join(
      MODELS_DIR,
      "3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced/model.onnx",
    ),
    numThreads: 1,
  });

  const speakerSegments = new Map<number, DiarizationTurn[]>();
  for (const turn of turns) {
    const list = speakerSegments.get(turn.speaker) ?? [];
    list.push(turn);
    speakerSegments.set(turn.speaker, list);
  }

  const speakerEmbeddings = new Map<number, Float32Array>();
  for (const [speakerId, segs] of speakerSegments) {
    const embeddings: Float32Array[] = [];

    for (const seg of segs) {
      const startSample = Math.floor(seg.start * SAMPLE_RATE);
      const endSample = Math.floor(seg.end * SAMPLE_RATE);
      const segSamples = samples.slice(startSample, endSample);

      if (segSamples.length < MIN_SEGMENT_SECS * SAMPLE_RATE) continue;

      const stream = extractor.createStream();
      stream.acceptWaveform(SAMPLE_RATE, segSamples);
      stream.inputFinished();
      embeddings.push(extractor.compute(stream));
    }

    if (embeddings.length === 0) continue;

    // Mean pooling over all of this speaker's segments
    const mean = new Float32Array(EMBEDDING_DIM);
    for (const emb of embeddings) {
      for (let i = 0; i < EMBEDDING_DIM; i++) mean[i] += emb[i];
    }
    for (let i = 0; i < EMBEDDING_DIM; i++) mean[i] /= embeddings.length;
    speakerEmbeddings.set(speakerId, mean);
  }

  return { turns, speakerEmbeddings };
}

function loadAudioAt16kHz(audioPath: string): Float32Array {
  const pcm = execSync(
    `ffmpeg -i "${audioPath}" -ac 1 -ar ${SAMPLE_RATE} -f f32le -loglevel error pipe:1`,
    { maxBuffer: 500 * 1024 * 1024 },
  );
  return new Float32Array(pcm.buffer, pcm.byteOffset, pcm.byteLength / 4);
}
