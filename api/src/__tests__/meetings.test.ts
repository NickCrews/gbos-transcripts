import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "./fixtures/db";
import {
  createMunicipality,
  createMeeting,
  createAgendaItem,
  createPerson,
  createSegment,
  resetCounters,
} from "./fixtures/seed";
import { listMeetings, getMeetingById } from "../db/queries";

describe("listMeetings", () => {
  let db: ReturnType<typeof createTestDb>;
  let muniId: number;

  beforeEach(() => {
    resetCounters();
    db = createTestDb();
    const muni = createMunicipality(db);
    muniId = muni.id;
  });

  it("returns empty list when no meetings", async () => {
    const result = await listMeetings(db, {});
    expect(result.meetings).toHaveLength(0);
    expect(result.total).toBe(0);
  });

  it("returns all meetings", async () => {
    createMeeting(db, muniId);
    createMeeting(db, muniId);
    const result = await listMeetings(db, {});
    expect(result.meetings).toHaveLength(2);
    expect(result.total).toBe(2);
  });

  it("filters by municipality short_name", async () => {
    createMeeting(db, muniId);
    const result = await listMeetings(db, { municipality: "gbos" });
    expect(result.meetings).toHaveLength(1);
  });

  it("filters by meeting type", async () => {
    createMeeting(db, muniId, { meetingType: "regular" });
    createMeeting(db, muniId, { meetingType: "special" });
    const regular = await listMeetings(db, { type: "regular" });
    expect(regular.meetings).toHaveLength(1);
    expect(regular.meetings[0].meetingType).toBe("regular");
  });

  it("filters by year", async () => {
    createMeeting(db, muniId, { meetingDate: "2024-06-01" });
    createMeeting(db, muniId, { meetingDate: "2025-01-15" });
    const result = await listMeetings(db, { year: "2024" });
    expect(result.meetings).toHaveLength(1);
    expect(result.meetings[0].meetingDate).toBe("2024-06-01");
  });

  it("filters by after date", async () => {
    createMeeting(db, muniId, { meetingDate: "2024-01-01" });
    createMeeting(db, muniId, { meetingDate: "2025-06-01" });
    const result = await listMeetings(db, { after: "2025-01-01" });
    expect(result.meetings).toHaveLength(1);
    expect(result.meetings[0].meetingDate).toBe("2025-06-01");
  });

  it("filters by before date", async () => {
    createMeeting(db, muniId, { meetingDate: "2024-01-01" });
    createMeeting(db, muniId, { meetingDate: "2025-06-01" });
    const result = await listMeetings(db, { before: "2025-01-01" });
    expect(result.meetings).toHaveLength(1);
    expect(result.meetings[0].meetingDate).toBe("2024-01-01");
  });

  it("respects pagination limit", async () => {
    for (let i = 0; i < 5; i++) createMeeting(db, muniId);
    const result = await listMeetings(db, { limit: 2 });
    expect(result.meetings).toHaveLength(2);
    expect(result.total).toBe(5);
  });

  it("respects pagination offset", async () => {
    for (let i = 0; i < 3; i++) createMeeting(db, muniId);
    const page1 = await listMeetings(db, { limit: 2, page: 1 });
    const page2 = await listMeetings(db, { limit: 2, page: 2 });
    expect(page1.meetings).toHaveLength(2);
    expect(page2.meetings).toHaveLength(1);
    expect(page1.meetings[0].id).not.toBe(page2.meetings[0].id);
  });

  it("orders by meeting_date descending", async () => {
    createMeeting(db, muniId, { meetingDate: "2024-01-01" });
    createMeeting(db, muniId, { meetingDate: "2025-06-01" });
    const result = await listMeetings(db, {});
    expect(result.meetings[0].meetingDate).toBe("2025-06-01");
  });
});

describe("getMeetingById", () => {
  let db: ReturnType<typeof createTestDb>;
  let muniId: number;

  beforeEach(() => {
    resetCounters();
    db = createTestDb();
    const muni = createMunicipality(db);
    muniId = muni.id;
  });

  it("returns null for unknown id", async () => {
    const result = await getMeetingById(db, 9999);
    expect(result).toBeNull();
  });

  it("returns meeting with agenda items and segment count", async () => {
    const meeting = createMeeting(db, muniId);
    createAgendaItem(db, meeting.id, { title: "Item 1" });
    createAgendaItem(db, meeting.id, { title: "Item 2" });
    createSegment(db, meeting.id, { text: "Some text" });
    createSegment(db, meeting.id, { text: "More text" });

    const result = await getMeetingById(db, meeting.id);
    expect(result).not.toBeNull();
    expect(result!.agendaItems).toHaveLength(2);
    expect(result!.segmentCount).toBe(2);
  });

  it("includes speakers list", async () => {
    const meeting = createMeeting(db, muniId);
    const person = createPerson(db, { name: "Alice" });
    createSegment(db, meeting.id, { personId: person.id, text: "Hello" });

    const result = await getMeetingById(db, meeting.id);
    expect(result!.speakers).toHaveLength(1);
    expect(result!.speakers[0].name).toBe("Alice");
  });

  it("returns youtubeUrl as computed field", async () => {
    const meeting = createMeeting(db, muniId, { youtubeId: "abc123" });
    const result = await getMeetingById(db, meeting.id);
    expect(result!.youtubeUrl).toBe("https://www.youtube.com/watch?v=abc123");
  });
});
