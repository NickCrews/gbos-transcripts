/**
 * Search route: GET /api/v1/search
 *
 * Supports lexical (FTS5), semantic (vec), and hybrid search.
 * Hybrid: 0.6 * semantic_score + 0.4 * lexical_score, deduplicated, re-ranked.
 */

import { Hono } from "hono";
import { sql, eq, and, like } from "drizzle-orm";
import type { Db } from "../db/connection";
import { segments, meetings, people, municipalities } from "../db/schema";
import { parsePagination } from "../db/queries";

const search = new Hono<{ Variables: { db: Db } }>();

// Encode a query string to a 384-dim embedding using @xenova/transformers
async function encodeQuery(text: string): Promise<Float32Array> {
  const { pipeline } = await import("@xenova/transformers");
  const encoder = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
  const output = await encoder(text, { pooling: "mean", normalize: true });
  return output.data as Float32Array;
}

function float32ArrayToBlob(arr: Float32Array): Buffer {
  return Buffer.from(arr.buffer);
}

interface SearchResult {
  segmentId: number;
  text: string;
  startTime: number;
  endTime: number;
  meetingId: number;
  meetingTitle: string | null;
  meetingDate: string | null;
  personId: number | null;
  personName: string | null;
  score: number;
  highlight?: string;
}

// GET /api/v1/search
search.get("/", async (c) => {
  const db = c.get("db");
  const query = c.req.query();

  const q = query.q?.trim();
  if (!q) {
    return c.json({ error: "q parameter is required" }, 400);
  }

  const mode = (query.mode as "lexical" | "semantic" | "hybrid") || "hybrid";
  const { offset, limit } = parsePagination({
    page: query.page ? Number(query.page) : undefined,
    limit: query.limit ? Number(query.limit) : undefined,
  });

  // Optional filters
  const filters: string[] = [];
  if (query.meeting_id) filters.push(`s.meeting_id = ${Number(query.meeting_id)}`);
  if (query.person_id) filters.push(`s.person_id = ${Number(query.person_id)}`);
  if (query.year) filters.push(`m.meeting_date LIKE '${query.year}-%'`);
  if (query.municipality) {
    filters.push(
      `m.municipality_id = (SELECT id FROM municipalities WHERE short_name = '${query.municipality.replace(/'/g, "''")}')`
    );
  }
  const filterClause = filters.length > 0 ? `AND ${filters.join(" AND ")}` : "";

  const sqlite = (db as any).session?.client ?? (db as any)._client;
  if (!sqlite) {
    return c.json({ error: "Database connection unavailable" }, 500);
  }

  let results: SearchResult[] = [];

  if (mode === "lexical" || mode === "hybrid") {
    // FTS5 lexical search
    const lexicalRows = sqlite
      .prepare(
        `
        SELECT s.id, s.text, s.start_time, s.end_time, s.meeting_id, s.person_id,
               m.title as meeting_title, m.meeting_date,
               p.name as person_name,
               bm25(segments_fts) as bm25_score
        FROM segments_fts
        JOIN segments s ON s.id = segments_fts.rowid
        JOIN meetings m ON m.id = s.meeting_id
        LEFT JOIN people p ON p.id = s.person_id
        WHERE segments_fts MATCH ?
          ${filterClause}
        ORDER BY bm25_score
        LIMIT ? OFFSET ?
        `
      )
      .all(q, limit * 2, 0) as any[];

    // Normalise BM25 scores to [0, 1] (BM25 is negative in SQLite; more negative = better)
    const scores = lexicalRows.map((r) => r.bm25_score as number);
    const minScore = Math.min(...scores, 0);
    const maxScore = Math.max(...scores, -1);
    const range = maxScore - minScore || 1;

    for (const row of lexicalRows) {
      const normScore = (row.bm25_score - minScore) / range; // 0 = worst, 1 = best
      results.push({
        segmentId: row.id,
        text: row.text,
        startTime: row.start_time,
        endTime: row.end_time,
        meetingId: row.meeting_id,
        meetingTitle: row.meeting_title,
        meetingDate: row.meeting_date,
        personId: row.person_id,
        personName: row.person_name,
        score: mode === "hybrid" ? 0.4 * normScore : normScore,
      });
    }
  }

  if (mode === "semantic" || mode === "hybrid") {
    try {
      const embedding = await encodeQuery(q);
      const embBlob = float32ArrayToBlob(embedding);

      const semanticRows = sqlite
        .prepare(
          `
          SELECT vs.segment_id, vs.distance,
                 s.text, s.start_time, s.end_time, s.meeting_id, s.person_id,
                 m.title as meeting_title, m.meeting_date,
                 p.name as person_name
          FROM vec_segments vs
          JOIN segments s ON s.id = vs.segment_id
          JOIN meetings m ON m.id = s.meeting_id
          LEFT JOIN people p ON p.id = s.person_id
          WHERE vs.embedding MATCH ?
            AND vs.k = ?
            ${filterClause.replace(/s\./g, "s.")}
          ORDER BY vs.distance
          LIMIT ?
          `
        )
        .all(embBlob, limit * 2, limit * 2) as any[];

      for (const row of semanticRows) {
        // cosine distance [0, 2]; convert to similarity [0, 1]
        const similarity = 1 - row.distance / 2;
        const existing = results.find((r) => r.segmentId === row.segment_id);
        if (existing) {
          existing.score += 0.6 * similarity;
        } else {
          results.push({
            segmentId: row.segment_id,
            text: row.text,
            startTime: row.start_time,
            endTime: row.end_time,
            meetingId: row.meeting_id,
            meetingTitle: row.meeting_title,
            meetingDate: row.meeting_date,
            personId: row.person_id,
            personName: row.person_name,
            score: mode === "hybrid" ? 0.6 * similarity : similarity,
          });
        }
      }
    } catch {
      // If @xenova/transformers is not available, fall back to lexical only
      if (mode === "semantic") {
        return c.json(
          { error: "Semantic search requires @xenova/transformers to be installed" },
          501
        );
      }
    }
  }

  // Sort by score descending, deduplicate, paginate
  results.sort((a, b) => b.score - a.score);
  const page = results.slice(offset, offset + limit);

  return c.json({
    query: q,
    mode,
    results: page,
    total: results.length,
    limit,
    offset,
  });
});

export default search;
