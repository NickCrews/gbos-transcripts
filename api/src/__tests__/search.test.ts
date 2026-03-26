/**
 * Search tests: lexical (FTS5) search with known seed data.
 * Semantic/hybrid tests require @xenova/transformers and are marked integration.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, getRawSqlite } from "./fixtures/db";
import {
  createMunicipality,
  createMeeting,
  createSegment,
  createPerson,
  resetCounters,
} from "./fixtures/seed";

describe("FTS5 lexical search ranking", () => {
  let db: ReturnType<typeof createTestDb>;
  let muniId: number;
  let meetingId: number;

  beforeEach(() => {
    resetCounters();
    db = createTestDb();
    const muni = createMunicipality(db);
    muniId = muni.id;
    const meeting = createMeeting(db, muniId);
    meetingId = meeting.id;
  });

  it("finds segments matching a keyword", () => {
    const sqlite = getRawSqlite(db);
    createSegment(db, meetingId, {
      text: "We need to fix the Crow Creek Road pothole.",
    });
    createSegment(db, meetingId, {
      text: "The budget proposal looks good.",
    });

    const rows = sqlite
      .prepare(
        `SELECT s.id, s.text FROM segments_fts
         JOIN segments s ON s.id = segments_fts.rowid
         WHERE segments_fts MATCH ?`
      )
      .all("pothole");

    expect(rows).toHaveLength(1);
    expect((rows[0] as any).text).toContain("pothole");
  });

  it("returns multiple results ordered by BM25 relevance", () => {
    const sqlite = getRawSqlite(db);
    // Segment with 'trail' mentioned multiple times — should rank higher
    createSegment(db, meetingId, {
      text: "The trail the trail the trail needs work.",
    });
    createSegment(db, meetingId, {
      text: "We discussed the trail briefly.",
    });

    const rows = sqlite
      .prepare(
        `SELECT s.id, s.text, bm25(segments_fts) AS score
         FROM segments_fts
         JOIN segments s ON s.id = segments_fts.rowid
         WHERE segments_fts MATCH ?
         ORDER BY score`
      )
      .all("trail") as any[];

    expect(rows.length).toBe(2);
    // BM25 is negative; more negative = more relevant
    expect(rows[0].score).toBeLessThan(rows[1].score);
    expect(rows[0].text).toContain("trail the trail the trail");
  });

  it("returns no results for unknown term", () => {
    const sqlite = getRawSqlite(db);
    createSegment(db, meetingId, { text: "Regular meeting content." });

    const rows = sqlite
      .prepare(
        `SELECT * FROM segments_fts WHERE segments_fts MATCH ?`
      )
      .all("xyzzyunknownterm");

    expect(rows).toHaveLength(0);
  });

  it("supports phrase search", () => {
    const sqlite = getRawSqlite(db);
    createSegment(db, meetingId, {
      text: "I move to approve the consent agenda.",
    });
    createSegment(db, meetingId, {
      text: "The consent discussion was brief.",
    });

    const rows = sqlite
      .prepare(
        `SELECT s.id FROM segments_fts
         JOIN segments s ON s.id = segments_fts.rowid
         WHERE segments_fts MATCH ?`
      )
      .all('"consent agenda"');

    expect(rows).toHaveLength(1);
  });

  it("filters by meeting_id in lexical search", () => {
    const sqlite = getRawSqlite(db);
    const m2 = createMeeting(db, muniId);

    createSegment(db, meetingId, { text: "Fire department budget review." });
    createSegment(db, m2.id, { text: "Fire station roof repair needed." });

    const rows = sqlite
      .prepare(
        `SELECT s.id, s.meeting_id FROM segments_fts
         JOIN segments s ON s.id = segments_fts.rowid
         WHERE segments_fts MATCH ?
           AND s.meeting_id = ?`
      )
      .all("fire", meetingId) as any[];

    expect(rows).toHaveLength(1);
    expect(rows[0].meeting_id).toBe(meetingId);
  });

  it("filters by person_id in lexical search", () => {
    const sqlite = getRawSqlite(db);
    const p1 = createPerson(db, { name: "Alice" });
    const p2 = createPerson(db, { name: "Bob" });

    createSegment(db, meetingId, {
      text: "I second the motion.",
      personId: p1.id,
    });
    createSegment(db, meetingId, {
      text: "I second that thought.",
      personId: p2.id,
    });

    const rows = sqlite
      .prepare(
        `SELECT s.id, s.person_id FROM segments_fts
         JOIN segments s ON s.id = segments_fts.rowid
         WHERE segments_fts MATCH ?
           AND s.person_id = ?`
      )
      .all("second", p1.id) as any[];

    expect(rows).toHaveLength(1);
    expect(rows[0].person_id).toBe(p1.id);
  });
});
