// Word Error Rate via Levenshtein distance over normalized word tokens.
// WER = (substitutions + deletions + insertions) / reference_word_count.

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

export function computeWER(reference: string, hypothesis: string): WERResult {
  const ref = normalizeForWER(reference);
  const hyp = normalizeForWER(hypothesis);
  const { substitutions, deletions, insertions } = editCounts(ref, hyp);
  const ref_word_count = ref.length;
  const wer = ref_word_count === 0 ? (hyp.length === 0 ? 0 : 1) : (substitutions + deletions + insertions) / ref_word_count;
  return { wer, substitutions, deletions, insertions, ref_word_count };
}

function editCounts(
  ref: string[],
  hyp: string[],
): { substitutions: number; deletions: number; insertions: number } {
  const m = ref.length;
  const n = hyp.length;
  // dp[i][j] = { cost, sub, del, ins } for aligning ref[..i] against hyp[..j]
  const dp: { cost: number; sub: number; del: number; ins: number }[][] = Array.from(
    { length: m + 1 },
    () => Array(n + 1),
  );
  dp[0]![0] = { cost: 0, sub: 0, del: 0, ins: 0 };
  for (let i = 1; i <= m; i++) dp[i]![0] = { cost: i, sub: 0, del: i, ins: 0 };
  for (let j = 1; j <= n; j++) dp[0]![j] = { cost: j, sub: 0, del: 0, ins: j };

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const match = ref[i - 1] === hyp[j - 1];
      const subPrev = dp[i - 1]![j - 1]!;
      const delPrev = dp[i - 1]![j]!;
      const insPrev = dp[i]![j - 1]!;
      const subCost = subPrev.cost + (match ? 0 : 1);
      const delCost = delPrev.cost + 1;
      const insCost = insPrev.cost + 1;
      const min = Math.min(subCost, delCost, insCost);
      if (min === subCost) {
        dp[i]![j] = {
          cost: subCost,
          sub: subPrev.sub + (match ? 0 : 1),
          del: subPrev.del,
          ins: subPrev.ins,
        };
      } else if (min === delCost) {
        dp[i]![j] = { cost: delCost, sub: delPrev.sub, del: delPrev.del + 1, ins: delPrev.ins };
      } else {
        dp[i]![j] = { cost: insCost, sub: insPrev.sub, del: insPrev.del, ins: insPrev.ins + 1 };
      }
    }
  }
  const final = dp[m]![n]!;
  return { substitutions: final.sub, deletions: final.del, insertions: final.ins };
}
