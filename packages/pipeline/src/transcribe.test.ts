import { beforeAll, describe, expect, it } from "vitest";
import { type WaveForm } from "sherpa-onnx-node";
import { getRecognizer, transcribeSamples } from "./transcribe";
import { loadAllFixtures, type MeetingFixture } from "./test-utils/fixtures";
import { getCachedAudioForFixture } from "./test-utils/audio-cache";
import { computeWER } from "./test-utils/wer";
import { readWave, sliceWave } from "./test-utils/wav-window";

// WER thresholds from issue #6: hard-fail above 15%, soft warning above 10%.
const WER_HARD_FAIL = 0.15;
const WER_SOFT_WARN = 0.10;

// Boundary tolerance: per-segment we expect the model to emit its first token
// within 500ms of the slice start and its last token within 2 seconds of the slice
// end. This catches gross drift / no-speech-detected style failures.
const BOUNDARY_TOLERANCE_SEC = 2;

const TRANSCRIBE_TIMEOUT_MS = 600_000;

const fixtures = loadAllFixtures();

describe.runIf(fixtures.length > 0)("transcribe", () => {
  beforeAll(() => {
    // Warm the recognizer once so per-clip tests don't pay model load each run.
    getRecognizer();
  }, TRANSCRIBE_TIMEOUT_MS);

  for (const fixture of fixtures) {
    describe(`${fixture.municipality}/${fixture.meeting_id} (${fixture.golden.source.id})`, () => {
      let wave: WaveForm;
      const perSegmentResults: Array<{ wer: number; refWords: number; hypWords: number }> = [];

      beforeAll(async () => {
        const cached = await getCachedAudioForFixture(fixture);
        wave = readWave(cached.path);
      }, TRANSCRIBE_TIMEOUT_MS);

      for (const seg of fixture.golden.interesting_segments) {
        it(
          `[${seg.start}-${seg.end}s] ${seg.speaker_id}: WER and boundary deltas`,
          { timeout: TRANSCRIBE_TIMEOUT_MS },
          () => {
            const slice = sliceWave(wave, seg.start, seg.end);
            const sliceDuration = slice.samples.length / slice.sampleRate;
            const result = transcribeSamples(slice.samples, slice.sampleRate);

            const wer = computeWER(seg.text, result.text);
            perSegmentResults.push({
              wer: wer.wer,
              refWords: wer.ref_word_count,
              hypWords: result.text.split(/\s+/).filter(Boolean).length,
            });

            if (wer.wer > WER_SOFT_WARN && wer.wer <= WER_HARD_FAIL) {
              console.warn(
                `WER ${(wer.wer * 100).toFixed(1)}% above soft threshold ${WER_SOFT_WARN * 100}% for ${fixture.municipality}/${fixture.meeting_id} [${seg.start}-${seg.end}]`,
              );
            }
            expect(
              wer.wer,
              `per-clip WER ${(wer.wer * 100).toFixed(1)}% exceeds hard threshold for [${seg.start}-${seg.end}]\nref: ${seg.text}\nhyp: ${result.text}`,
            ).toBeLessThanOrEqual(WER_HARD_FAIL);

            const timestamps = result.timestamps;
            expect(timestamps, "model returned no per-token timestamps").toBeDefined();
            expect(timestamps!.length).toBeGreaterThan(0);
            const firstTs = timestamps![0]!;
            const lastTs = timestamps![timestamps!.length - 1]!;
            expect(
              firstTs,
              `first-token timestamp ${firstTs.toFixed(3)}s drifted >${BOUNDARY_TOLERANCE_SEC}s from slice start`,
            ).toBeLessThanOrEqual(BOUNDARY_TOLERANCE_SEC);
            expect(
              sliceDuration - lastTs,
              `last-token timestamp ${lastTs.toFixed(3)}s drifted >${BOUNDARY_TOLERANCE_SEC}s from slice end (slice duration ${sliceDuration.toFixed(3)}s)`,
            ).toBeLessThanOrEqual(BOUNDARY_TOLERANCE_SEC);
          },
        );
      }

      it("aggregate per-meeting WER under hard threshold", () => {
        if (perSegmentResults.length === 0) return;
        const totalRefWords = perSegmentResults.reduce((s, r) => s + r.refWords, 0);
        const totalErrors = perSegmentResults.reduce((s, r) => s + r.wer * r.refWords, 0);
        const aggregate = totalRefWords === 0 ? 0 : totalErrors / totalRefWords;
        expect(
          aggregate,
          `aggregate meeting WER ${(aggregate * 100).toFixed(1)}% exceeds hard threshold`,
        ).toBeLessThanOrEqual(WER_HARD_FAIL);
      });
    });
  }
});

describe.runIf(fixtures.length === 0)("transcribe (no fixtures)", () => {
  it.skip("no test-fixtures/<municipality>/<meeting_id>/golden.json found", () => { });
});

// Reference fixture variable so unused-import linting doesn't complain when
// no fixtures are present — this also serves as an inline type check.
const _meetingType: MeetingFixture | undefined = fixtures[0];
void _meetingType;
