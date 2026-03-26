import { Hono } from "hono";
import type { Db } from "../db/connection";
import {
  getMeetingById,
  getMeetingTranscript,
  listMeetings,
} from "../db/queries";

const meetings = new Hono<{ Variables: { db: Db } }>();

// GET /api/v1/meetings
meetings.get("/", async (c) => {
  const db = c.get("db");
  const query = c.req.query();

  const result = await listMeetings(db, {
    page: query.page ? Number(query.page) : undefined,
    limit: query.limit ? Number(query.limit) : undefined,
    municipality: query.municipality,
    type: query.type,
    year: query.year,
    after: query.after,
    before: query.before,
  });

  return c.json(result);
});

// GET /api/v1/meetings/:id
meetings.get("/:id", async (c) => {
  const db = c.get("db");
  const id = Number(c.req.param("id"));

  if (!Number.isInteger(id) || id < 1) {
    return c.json({ error: "Invalid meeting ID" }, 400);
  }

  const meeting = await getMeetingById(db, id);
  if (!meeting) {
    return c.json({ error: "Meeting not found" }, 404);
  }

  return c.json(meeting);
});

// GET /api/v1/meetings/:id/transcript
meetings.get("/:id/transcript", async (c) => {
  const db = c.get("db");
  const id = Number(c.req.param("id"));
  const query = c.req.query();

  if (!Number.isInteger(id) || id < 1) {
    return c.json({ error: "Invalid meeting ID" }, 400);
  }

  const meeting = await getMeetingById(db, id);
  if (!meeting) {
    return c.json({ error: "Meeting not found" }, 404);
  }

  const segs = await getMeetingTranscript(db, id, {
    personId: query.person ? Number(query.person) : undefined,
    from: query.from ? Number(query.from) : undefined,
    to: query.to ? Number(query.to) : undefined,
  });

  return c.json({ meetingId: id, segments: segs });
});

export default meetings;
