// Word Error Rate via Levenshtein distance over normalized word tokens.
// WER = (substitutions + deletions + insertions) / reference_word_count.

import type { TranscriptWord } from "../types.ts";

export interface WERResult {
  wer: number;
  substitutions: number;
  deletions: number;
  insertions: number;
  ref_word_count: number;
}

export function normalizeForWER(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function normalizeToken(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}']/gu, "");
}

export function computeWER(reference: string, hypothesis: string): WERResult {
  const ref = normalizeForWER(reference);
  const hyp = normalizeForWER(hypothesis);
  const ops = alignTokens(ref, hyp);
  const { substitutions, deletions, insertions } = tallyOps(ops);
  const ref_word_count = ref.length;
  const wer = ref_word_count === 0 ? (hyp.length === 0 ? 0 : 1) : (substitutions + deletions + insertions) / ref_word_count;
  return { wer, substitutions, deletions, insertions, ref_word_count };
}

export type AlignmentOp = "match" | "sub" | "del" | "ins";

export interface AlignedWordPair {
  op: AlignmentOp;
  // refIdx/hypIdx index into the original input arrays. -1 means "no word on this side".
  refIdx: number;
  hypIdx: number;
}

// Align two word sequences (Levenshtein) and return the alignment path. Tokens
// are compared after normalizeToken() so punctuation/case differences don't
// register as substitutions.
export function alignWords(
  ref: readonly TranscriptWord[],
  hyp: readonly TranscriptWord[],
): AlignedWordPair[] {
  const refTokens = ref.map((w) => normalizeToken(w.text));
  const hypTokens = hyp.map((w) => normalizeToken(w.text));
  return alignTokens(refTokens, hypTokens);
}

function alignTokens(ref: readonly string[], hyp: readonly string[]): AlignedWordPair[] {
  const m = ref.length;
  const n = hyp.length;
  const cost: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  const back: AlignmentOp[][] = Array.from({ length: m + 1 }, () =>
    new Array<AlignmentOp>(n + 1).fill("match"),
  );
  for (let i = 1; i <= m; i++) {
    cost[i]![0] = i;
    back[i]![0] = "del";
  }
  for (let j = 1; j <= n; j++) {
    cost[0]![j] = j;
    back[0]![j] = "ins";
  }
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const isMatch = ref[i - 1] === hyp[j - 1];
      const subCost = cost[i - 1]![j - 1]! + (isMatch ? 0 : 1);
      const delCost = cost[i - 1]![j]! + 1;
      const insCost = cost[i]![j - 1]! + 1;
      const min = Math.min(subCost, delCost, insCost);
      cost[i]![j] = min;
      if (min === subCost) {
        back[i]![j] = isMatch ? "match" : "sub";
      } else if (min === delCost) {
        back[i]![j] = "del";
      } else {
        back[i]![j] = "ins";
      }
    }
  }

  const ops: AlignedWordPair[] = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    const op = back[i]![j]!;
    if (op === "match" || op === "sub") {
      ops.push({ op, refIdx: i - 1, hypIdx: j - 1 });
      i--;
      j--;
    } else if (op === "del") {
      ops.push({ op, refIdx: i - 1, hypIdx: -1 });
      i--;
    } else {
      ops.push({ op, refIdx: -1, hypIdx: j - 1 });
      j--;
    }
  }
  ops.reverse();
  return ops;
}

function tallyOps(ops: readonly AlignedWordPair[]): {
  matches: number;
  substitutions: number;
  deletions: number;
  insertions: number;
} {
  let matches = 0;
  let substitutions = 0;
  let deletions = 0;
  let insertions = 0;
  for (const o of ops) {
    if (o.op === "match") matches++;
    else if (o.op === "sub") substitutions++;
    else if (o.op === "del") deletions++;
    else insertions++;
  }
  return { matches, substitutions, deletions, insertions };
}

export interface TranscriptComparison {
  wer: number;
  matches: number;
  substitutions: number;
  deletions: number;
  insertions: number;
  refWordCount: number;
  hypWordCount: number;
  // Timestamp error stats over matched-only pairs (substitutions excluded —
  // they may be different words and timestamps aren't meaningful to compare).
  // Errors are absolute differences in seconds, separately for start and end.
  matchedPairs: number;
  meanStartError: number;
  meanEndError: number;
  maxStartError: number;
  maxEndError: number;
  // 95th-percentile absolute errors — robust to a handful of outliers.
  p95StartError: number;
  p95EndError: number;
}

export function compareTranscripts(
  ref: readonly TranscriptWord[],
  hyp: readonly TranscriptWord[],
): TranscriptComparison {
  const ops = alignWords(ref, hyp);
  const { matches, substitutions, deletions, insertions } = tallyOps(ops);
  const refWordCount = ref.length;
  const hypWordCount = hyp.length;
  const wer =
    refWordCount === 0
      ? hypWordCount === 0
        ? 0
        : 1
      : (substitutions + deletions + insertions) / refWordCount;

  const startErrs: number[] = [];
  const endErrs: number[] = [];
  for (const op of ops) {
    if (op.op !== "match") continue;
    const r = ref[op.refIdx]!;
    const h = hyp[op.hypIdx]!;
    startErrs.push(Math.abs(r.start - h.start));
    endErrs.push(Math.abs(r.end - h.end));
  }

  return {
    wer,
    matches,
    substitutions,
    deletions,
    insertions,
    refWordCount,
    hypWordCount,
    matchedPairs: startErrs.length,
    meanStartError: mean(startErrs),
    meanEndError: mean(endErrs),
    maxStartError: max(startErrs),
    maxEndError: max(endErrs),
    p95StartError: percentile(startErrs, 0.95),
    p95EndError: percentile(endErrs, 0.95),
  };
}

function mean(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

function max(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  let m = xs[0]!;
  for (const x of xs) if (x > m) m = x;
  return m;
}

function percentile(xs: readonly number[], p: number): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx]!;
}
