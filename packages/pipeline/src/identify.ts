import pgvector from "pgvector";
import { sql } from "./db.ts";
import type { DiarizationTurn } from "./types.ts";

// Confidence tiers from OpenWhispr's matching system:
//   ≥ 0.70 cosine similarity → auto-confirm
//   0.55–0.70               → suggest (we auto-confirm here too)
//   < 0.55                  → new person
const MATCH_THRESHOLD = 0.55;

export async function identifyAndInsertSegments(
  meetingId: number,
  alignedSegments: Array<{
    text: string;
    start: number;
    end: number;
    speaker: number;
  }>,
  speakerEmbeddings: Map<number, Float32Array>,
): Promise<void> {
  // Resolve each local speaker index to a DB person
  const speakerToPersonId = new Map<number, number>();
  for (const [speakerId, embedding] of speakerEmbeddings) {
    speakerToPersonId.set(speakerId, await findOrCreatePerson(embedding));
  }

  // Batch-insert aligned segments
  for (const seg of alignedSegments) {
    const personId = speakerToPersonId.get(seg.speaker) ?? null;
    await sql`
      INSERT INTO segments (meeting_id, person_id, text, start_secs, end_secs)
      VALUES (
        ${meetingId},
        ${personId},
        ${seg.text},
        make_interval(secs => ${seg.start}),
        make_interval(secs => ${seg.end})
      )
    `;
  }
}

async function findOrCreatePerson(embedding: Float32Array): Promise<number> {
  const vec = pgvector.toSql(embedding);
  const distanceThreshold = 1 - MATCH_THRESHOLD; // cosine distance = 1 − similarity

  const [match] = await sql<Array<{ id: number }>>`
    SELECT id
    FROM people
    WHERE voice_embedding <=> ${vec}::vector < ${distanceThreshold}
    ORDER BY voice_embedding <=> ${vec}::vector
    LIMIT 1
  `;

  if (match) return match.id;

  const [{ id }] = await sql<Array<{ id: number }>>`
    INSERT INTO people (name, voice_embedding)
    VALUES ('Unknown Speaker', ${vec}::vector)
    RETURNING id
  `;
  return id;
}
