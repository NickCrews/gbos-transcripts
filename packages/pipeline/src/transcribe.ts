import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { TranscriptSegment } from "./types.ts";

// Whisper via ONNX — no Python required
// Downloads model once to ~/.cache/huggingface/hub on first run
let _transcriber: Awaited<ReturnType<typeof loadTranscriber>> | null = null;

async function loadTranscriber() {
  const { pipeline } = await import("@xenova/transformers");
  return pipeline("automatic-speech-recognition", "Xenova/whisper-large-v3", {
    revision: "no_attentions",
  });
}

export async function transcribeAudio(
  audioPath: string,
): Promise<TranscriptSegment[]> {
  _transcriber ??= await loadTranscriber();

  const result = await _transcriber(audioPath, {
    return_timestamps: "word",
    chunk_length_s: 30,
    stride_length_s: 5,
  });

  // Group word-level timestamps into sentence-like segments by silence gaps
  return groupIntoSegments(result.chunks ?? []);
}

function groupIntoSegments(
  words: Array<{ text: string; timestamp: [number, number] }>,
): TranscriptSegment[] {
  const SILENCE_GAP = 1.5; // seconds — new segment if gap exceeds this
  const segments: TranscriptSegment[] = [];
  let current: (typeof segments)[0] | null = null;

  for (const word of words) {
    const [start, end] = word.timestamp;
    if (!current || start - current.end > SILENCE_GAP) {
      if (current) segments.push(current);
      current = {
        text: word.text.trimStart(),
        start,
        end,
        words: [{ text: word.text, start, end }],
      };
    } else {
      current.text += word.text;
      current.end = end;
      current.words.push({ text: word.text, start, end });
    }
  }

  if (current) segments.push(current);
  return segments;
}
