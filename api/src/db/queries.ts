/**
 * Reusable query builders for the GBOS API.
 */

import { and, desc, eq, gte, lte, sql, like, inArray, count } from "drizzle-orm";
import type { Db } from "./connection";
import {
  meetings,
  segments,
  people,
  roles,
  municipalities,
  agendaItems,
} from "./schema";

// ---------------------------------------------------------------------------
// Pagination helper
// ---------------------------------------------------------------------------
export interface PaginationParams {
  page?: number;
  limit?: number;
}

export function parsePagination(params: PaginationParams): {
  offset: number;
  limit: number;
} {
  const limit = Math.min(Math.max(Number(params.limit) || 20, 1), 100);
  const page = Math.max(Number(params.page) || 1, 1);
  return { offset: (page - 1) * limit, limit };
}

// ---------------------------------------------------------------------------
// Meetings
// ---------------------------------------------------------------------------
export interface ListMeetingsParams extends PaginationParams {
  municipality?: string;
  type?: string;
  year?: string;
  after?: string;
  before?: string;
}

export async function listMeetings(db: Db, params: ListMeetingsParams) {
  const { offset, limit } = parsePagination(params);

  const conditions = [];

  if (params.municipality) {
    const muni = await db.query.municipalities.findFirst({
      where: eq(municipalities.shortName, params.municipality),
    });
    if (muni) conditions.push(eq(meetings.municipalityId, muni.id));
  }
  if (params.type) {
    conditions.push(eq(meetings.meetingType, params.type));
  }
  if (params.year) {
    conditions.push(like(meetings.meetingDate, `${params.year}-%`));
  }
  if (params.after) {
    conditions.push(gte(meetings.meetingDate, params.after));
  }
  if (params.before) {
    conditions.push(lte(meetings.meetingDate, params.before));
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, totalRows] = await Promise.all([
    db.query.meetings.findMany({
      where,
      orderBy: [desc(meetings.meetingDate)],
      limit,
      offset,
    }),
    db
      .select({ count: count() })
      .from(meetings)
      .where(where)
      .then((r) => r[0].count),
  ]);

  return { meetings: rows, total: totalRows, limit, offset };
}

export async function getMeetingById(db: Db, id: number) {
  const meeting = await db.query.meetings.findFirst({
    where: eq(meetings.id, id),
  });
  if (!meeting) return null;

  const [agendaRows, segmentCount, speakers] = await Promise.all([
    db.query.agendaItems.findMany({
      where: eq(agendaItems.meetingId, id),
      orderBy: [agendaItems.startTime],
    }),
    db
      .select({ count: count() })
      .from(segments)
      .where(eq(segments.meetingId, id))
      .then((r) => r[0].count),
    db
      .selectDistinct({ personId: segments.personId })
      .from(segments)
      .where(and(eq(segments.meetingId, id), sql`${segments.personId} IS NOT NULL`))
      .then((rows) =>
        rows.map((r) => r.personId).filter((id): id is number => id !== null)
      ),
  ]);

  let speakerDetails: (typeof people.$inferSelect)[] = [];
  if (speakers.length > 0) {
    speakerDetails = await db.query.people.findMany({
      where: inArray(people.id, speakers),
    });
  }

  return {
    ...meeting,
    agendaItems: agendaRows,
    segmentCount,
    speakers: speakerDetails,
  };
}

export async function getMeetingTranscript(
  db: Db,
  meetingId: number,
  opts: { personId?: number; from?: number; to?: number }
) {
  const conditions = [eq(segments.meetingId, meetingId)];
  if (opts.personId) conditions.push(eq(segments.personId, opts.personId));
  if (opts.from !== undefined) conditions.push(gte(segments.startTime, opts.from));
  if (opts.to !== undefined) conditions.push(lte(segments.endTime, opts.to));

  return db.query.segments.findMany({
    where: and(...conditions),
    orderBy: [segments.startTime],
  });
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------
export async function listPeople(
  db: Db,
  params: { role?: string; municipality?: string } & PaginationParams
) {
  const { offset, limit } = parsePagination(params);

  if (params.role || params.municipality) {
    // Join via roles table
    const roleConditions = [];
    if (params.role) roleConditions.push(eq(roles.role, params.role));
    if (params.municipality) {
      const muni = await db.query.municipalities.findFirst({
        where: eq(municipalities.shortName, params.municipality),
      });
      if (muni) roleConditions.push(eq(roles.municipalityId, muni.id));
    }

    const personIds = await db
      .selectDistinct({ personId: roles.personId })
      .from(roles)
      .where(and(...roleConditions))
      .then((rows) => rows.map((r) => r.personId));

    if (personIds.length === 0) return { people: [], total: 0, limit, offset };

    const [rows, total] = await Promise.all([
      db.query.people.findMany({
        where: inArray(people.id, personIds),
        limit,
        offset,
      }),
      personIds.length,
    ]);
    return { people: rows, total, limit, offset };
  }

  const [rows, total] = await Promise.all([
    db.query.people.findMany({ limit, offset }),
    db.select({ count: count() }).from(people).then((r) => r[0].count),
  ]);
  return { people: rows, total, limit, offset };
}

export async function getPersonById(db: Db, id: number) {
  const person = await db.query.people.findFirst({
    where: eq(people.id, id),
  });
  if (!person) return null;

  const [personRoles, stats] = await Promise.all([
    db.query.roles.findMany({ where: eq(roles.personId, id) }),
    db
      .select({
        meetingCount: sql<number>`COUNT(DISTINCT ${segments.meetingId})`,
        segmentCount: count(),
        totalSecs: sql<number>`SUM(${segments.durationSecs})`,
      })
      .from(segments)
      .where(eq(segments.personId, id))
      .then((r) => r[0]),
  ]);

  return { ...person, roles: personRoles, ...stats };
}

export async function getPersonSegments(
  db: Db,
  personId: number,
  opts: { meetingId?: number } & PaginationParams
) {
  const { offset, limit } = parsePagination(opts);
  const conditions = [eq(segments.personId, personId)];
  if (opts.meetingId) conditions.push(eq(segments.meetingId, opts.meetingId));

  const [rows, total] = await Promise.all([
    db.query.segments.findMany({
      where: and(...conditions),
      orderBy: [desc(segments.startTime)],
      limit,
      offset,
    }),
    db
      .select({ count: count() })
      .from(segments)
      .where(and(...conditions))
      .then((r) => r[0].count),
  ]);

  return { segments: rows, total, limit, offset };
}

// ---------------------------------------------------------------------------
// Segments
// ---------------------------------------------------------------------------
export async function getSegmentById(db: Db, id: number) {
  return (await db.query.segments.findFirst({ where: eq(segments.id, id) })) ?? null;
}
