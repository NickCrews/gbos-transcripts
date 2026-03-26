import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "./fixtures/db";
import {
  createMunicipality,
  createMeeting,
  createPerson,
  createRole,
  createSegment,
  resetCounters,
} from "./fixtures/seed";
import { listPeople, getPersonById, getPersonSegments } from "../db/queries";

describe("listPeople", () => {
  let db: ReturnType<typeof createTestDb>;
  let muniId: number;

  beforeEach(() => {
    resetCounters();
    db = createTestDb();
    const muni = createMunicipality(db);
    muniId = muni.id;
  });

  it("returns empty list when no people", async () => {
    const result = await listPeople(db, {});
    expect(result.people).toHaveLength(0);
    expect(result.total).toBe(0);
  });

  it("lists all people", async () => {
    createPerson(db, { name: "Alice" });
    createPerson(db, { name: "Bob" });
    const result = await listPeople(db, {});
    expect(result.people).toHaveLength(2);
    expect(result.total).toBe(2);
  });

  it("filters by role", async () => {
    const p1 = createPerson(db, { name: "Alice" });
    const p2 = createPerson(db, { name: "Bob" });
    createRole(db, { personId: p1.id, municipalityId: muniId, role: "board_member" });
    createRole(db, { personId: p2.id, municipalityId: muniId, role: "staff" });

    const result = await listPeople(db, { role: "board_member" });
    expect(result.people).toHaveLength(1);
    expect(result.people[0].name).toBe("Alice");
  });

  it("filters by municipality", async () => {
    const muni2 = createMunicipality(db, {
      name: "Other Municipality",
      shortName: "other",
    });
    const p1 = createPerson(db, { name: "Alice" });
    const p2 = createPerson(db, { name: "Bob" });
    createRole(db, { personId: p1.id, municipalityId: muniId, role: "board_member" });
    createRole(db, { personId: p2.id, municipalityId: muni2.id, role: "board_member" });

    const result = await listPeople(db, { municipality: "gbos" });
    expect(result.people).toHaveLength(1);
    expect(result.people[0].name).toBe("Alice");
  });

  it("paginates results", async () => {
    for (let i = 0; i < 5; i++) createPerson(db, { name: `Person ${i}` });
    const result = await listPeople(db, { limit: 2, page: 1 });
    expect(result.people).toHaveLength(2);
  });
});

describe("getPersonById", () => {
  let db: ReturnType<typeof createTestDb>;
  let muniId: number;

  beforeEach(() => {
    resetCounters();
    db = createTestDb();
    const muni = createMunicipality(db);
    muniId = muni.id;
  });

  it("returns null for unknown id", async () => {
    const result = await getPersonById(db, 9999);
    expect(result).toBeNull();
  });

  it("returns person with roles", async () => {
    const person = createPerson(db, { name: "Carol" });
    createRole(db, {
      personId: person.id,
      municipalityId: muniId,
      role: "board_member",
      title: "Board Member",
    });

    const result = await getPersonById(db, person.id);
    expect(result).not.toBeNull();
    expect(result!.roles).toHaveLength(1);
    expect(result!.roles[0].role).toBe("board_member");
  });

  it("includes speaking stats", async () => {
    const person = createPerson(db, { name: "Dave" });
    const meeting = createMeeting(db, muniId);
    createSegment(db, meeting.id, {
      personId: person.id,
      text: "Hello world",
      startTime: 0,
      endTime: 5,
    });
    createSegment(db, meeting.id, {
      personId: person.id,
      text: "Another segment",
      startTime: 5,
      endTime: 10,
    });

    const result = await getPersonById(db, person.id);
    expect(result!.segmentCount).toBe(2);
    expect(result!.meetingCount).toBe(1);
  });
});

describe("getPersonSegments", () => {
  let db: ReturnType<typeof createTestDb>;
  let muniId: number;

  beforeEach(() => {
    resetCounters();
    db = createTestDb();
    const muni = createMunicipality(db);
    muniId = muni.id;
  });

  it("returns segments for a person", async () => {
    const person = createPerson(db, { name: "Eve" });
    const meeting = createMeeting(db, muniId);
    createSegment(db, meeting.id, { personId: person.id, text: "Seg 1" });
    createSegment(db, meeting.id, { personId: person.id, text: "Seg 2" });

    const result = await getPersonSegments(db, person.id, {});
    expect(result.segments).toHaveLength(2);
    expect(result.total).toBe(2);
  });

  it("filters by meeting_id", async () => {
    const person = createPerson(db, { name: "Frank" });
    const m1 = createMeeting(db, muniId);
    const m2 = createMeeting(db, muniId);
    createSegment(db, m1.id, { personId: person.id, text: "M1 seg" });
    createSegment(db, m2.id, { personId: person.id, text: "M2 seg" });

    const result = await getPersonSegments(db, person.id, { meetingId: m1.id });
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0].text).toBe("M1 seg");
  });

  it("paginates results", async () => {
    const person = createPerson(db, { name: "Gina" });
    const meeting = createMeeting(db, muniId);
    for (let i = 0; i < 5; i++) {
      createSegment(db, meeting.id, { personId: person.id, text: `Seg ${i}` });
    }
    const result = await getPersonSegments(db, person.id, { limit: 2, page: 1 });
    expect(result.segments).toHaveLength(2);
    expect(result.total).toBe(5);
  });
});
