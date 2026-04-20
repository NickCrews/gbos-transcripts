import pgvector from 'pgvector';
import { sql } from './db.ts';

// all-MiniLM-L6-v2 via ONNX — same model as sentence-transformers, runs in Node.js
// Downloads once to ~/.cache/huggingface/hub
let _embedder: Awaited<ReturnType<typeof loadEmbedder>> | null = null;

async function loadEmbedder() {
  const { pipeline } = await import('@xenova/transformers');
  return pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
}

export async function embedSegments(meetingId: number): Promise<void> {
  _embedder ??= await loadEmbedder();

  const segments = await sql<Array<{ id: number; text: string }>>`
    SELECT id, text FROM segments WHERE meeting_id = ${meetingId} AND text_embedding IS NULL
  `;

  for (const seg of segments) {
    const output = await _embedder(seg.text, { pooling: 'mean', normalize: true });
    const vec = pgvector.toSql(Array.from(output.data as Float32Array));

    await sql`
      UPDATE segments SET text_embedding = ${vec}::vector WHERE id = ${seg.id}
    `;
  }

  console.log(`Embedded ${segments.length} segments for meeting ${meetingId}`);
}
