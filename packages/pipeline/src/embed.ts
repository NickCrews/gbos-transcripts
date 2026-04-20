import { and, eq, isNull } from "drizzle-orm";
import { db, segmentsTable } from "@gbos/db";

// all-MiniLM-L6-v2 via ONNX — same model as sentence-transformers, runs in Node.js
// Downloads once to ~/.cache/huggingface/hub
let _embedder: Awaited<ReturnType<typeof loadEmbedder>> | null = null;

async function loadEmbedder() {
  const { pipeline } = await import("@xenova/transformers");
  return pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
}

export async function embedSegments(meetingId: number): Promise<void> {
  _embedder ??= await loadEmbedder();

  const segments = await db
    .select({ id: segmentsTable.id, text: segmentsTable.text })
    .from(segmentsTable)
    .where(
      and(
        eq(segmentsTable.meeting_id, meetingId),
        isNull(segmentsTable.text_embedding),
      ),
    );

  for (const seg of segments) {
    const output = await _embedder(seg.text, {
      pooling: "mean",
      normalize: true,
    });
    await db
      .update(segmentsTable)
      .set({ text_embedding: Array.from(output.data as Float32Array) })
      .where(eq(segmentsTable.id, seg.id));
  }

  console.log(`Embedded ${segments.length} segments for meeting ${meetingId}`);
}
