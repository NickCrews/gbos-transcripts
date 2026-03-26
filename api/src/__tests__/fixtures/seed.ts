/**
 * Factory functions for seeding test data.
 */

import type { TestDb } from "./db";
import {
  municipalities,
  people,
  roles,
  meetings,
  agendaItems,
  segments,
} from "../../db/schema";

// ---------------------------------------------------------------------------
// Municipalities
// ---------------------------------------------------------------------------
export function createMunicipality(
  db: TestDb,
  overrides: Partial<typeof municipalities.$inferInsert> = {}
) {
  return db
    .insert(municipalities)
    .values({
      name: "Girdwood Board of Supervisors",
      shortName: "gbos",
      state: "AK",
      youtubeChannelUrl: "https://www.youtube.com/@GirdwoodBOS/videos",
      ...overrides,
    })
    .returning()
    .get();
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------
export function createPerson(
  db: TestDb,
  overrides: Partial<typeof people.$inferInsert> = {}
) {
  return db
    .insert(people)
    .values({
      name: "Test Person",
      voiceSampleCount: 0,
      ...overrides,
    })
    .returning()
    .get();
}

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------
export function createRole(
  db: TestDb,
  overrides: Partial<typeof roles.$inferInsert> & {
    personId: number;
    municipalityId: number;
  }
) {
  return db
    .insert(roles)
    .values({
      role: "board_member",
      ...overrides,
    })
    .returning()
    .get();
}

// ---------------------------------------------------------------------------
// Meetings
// ---------------------------------------------------------------------------
let meetingCounter = 0;
export function createMeeting(
  db: TestDb,
  municipalityId: number,
  overrides: Partial<typeof meetings.$inferInsert> = {}
) {
  meetingCounter++;
  return db
    .insert(meetings)
    .values({
      municipalityId,
      youtubeId: `test_vid_${String(meetingCounter).padStart(4, "0")}`,
      title: `GBOS Regular Meeting 2025-0${meetingCounter}-21`,
      meetingDate: `2025-0${meetingCounter}-21`,
      meetingType: "regular",
      durationSecs: 3600,
      status: "embedded",
      ...overrides,
    })
    .returning()
    .get();
}

// ---------------------------------------------------------------------------
// Agenda items
// ---------------------------------------------------------------------------
export function createAgendaItem(
  db: TestDb,
  meetingId: number,
  overrides: Partial<typeof agendaItems.$inferInsert> = {}
) {
  return db
    .insert(agendaItems)
    .values({
      meetingId,
      title: "Test Agenda Item",
      itemType: "discussion",
      startTime: 0,
      endTime: 60,
      ...overrides,
    })
    .returning()
    .get();
}

// ---------------------------------------------------------------------------
// Segments
// ---------------------------------------------------------------------------
let segmentCounter = 0;
export function createSegment(
  db: TestDb,
  meetingId: number,
  overrides: Partial<typeof segments.$inferInsert> = {}
) {
  segmentCounter++;
  const start = (segmentCounter - 1) * 5.0;
  return db
    .insert(segments)
    .values({
      meetingId,
      text: `Test segment ${segmentCounter} text content`,
      startTime: start,
      endTime: start + 4.5,
      ...overrides,
    })
    .returning()
    .get();
}

// ---------------------------------------------------------------------------
// Reset counters (call between tests if needed)
// ---------------------------------------------------------------------------
export function resetCounters() {
  meetingCounter = 0;
  segmentCounter = 0;
}
