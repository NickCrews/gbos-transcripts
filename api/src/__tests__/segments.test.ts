import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "./fixtures/db";
import {
  createMunicipality,
  createMeeting,
  createSegment,
  createPerson,
  resetCounters,
} from "./fixtures/seed";
import { getSegmentById } from "../db/queries";

describe("getSegmentById", () => {
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

  it("returns null for unknown id", async () => {
    const result = await getSegmentById(db, 9999);
    expect(result).toBeNull();
  });

  it("returns segment by id", async () => {
    const seg = createSegment(db, meetingId, {
      text: "The meeting is called to order.",
      startTime: 1.0,
      endTime: 3.5,
    });

    const result = await getSegmentById(db, seg.id);
    expect(result).not.toBeNull();
    expect(result!.text).toBe("The meeting is called to order.");
    expect(result!.startTime).toBe(1.0);
    expect(result!.endTime).toBe(3.5);
  });

  it("includes computed duration_secs", async () => {
    const seg = createSegment(db, meetingId, {
      text: "Test",
      startTime: 10.0,
      endTime: 15.0,
    });

    const result = await getSegmentById(db, seg.id);
    expect(result!.durationSecs).toBe(5.0);
  });

  it("includes person_id when set", async () => {
    const person = createPerson(db, { name: "Alice" });
    const seg = createSegment(db, meetingId, {
      text: "Hello",
      personId: person.id,
    });

    const result = await getSegmentById(db, seg.id);
    expect(result!.personId).toBe(person.id);
  });

  it("returns null person_id when not set", async () => {
    const seg = createSegment(db, meetingId, { text: "Anon speech" });
    const result = await getSegmentById(db, seg.id);
    expect(result!.personId).toBeNull();
  });
});

describe("FTS5 full-text search", () => {
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

  it("FTS5 trigger inserts segment text", () => {
    const sqlite = (db as any)._sqlite;
    createSegment(db, meetingId, {
      text: "The Girdwood trail system requires maintenance",
    });

    const rows = sqlite
      .prepare("SELECT * FROM segments_fts WHERE segments_fts MATCH ?")
      .all("trail");

    expect(rows).toHaveLength(1);
  });

  it("FTS5 porter stemming matches word variants", () => {
    const sqlite = (db as any)._sqlite;
    createSegment(db, meetingId, { text: "We discussed the maintenance budget" });

    // 'discuss' should match 'discussed' via stemming
    const rows = sqlite
      .prepare("SELECT * FROM segments_fts WHERE segments_fts MATCH ?")
      .all("discuss");

    expect(rows.length).toBeGreaterThan(0);
  });

  it("FTS5 trigger removes text on delete", () => {
    const sqlite = (db as any)._sqlite;
    const seg = createSegment(db, meetingId, { text: "Unique phrase zxqwerty" });

    const before = sqlite
      .prepare("SELECT * FROM segments_fts WHERE segments_fts MATCH ?")
      .all("zxqwerty");
    expect(before).toHaveLength(1);

    sqlite.prepare("DELETE FROM segments WHERE id = ?").run(seg.id);

    const after = sqlite
      .prepare("SELECT * FROM segments_fts WHERE segments_fts MATCH ?")
      .all("zxqwerty");
    expect(after).toHaveLength(0);
  });
});
