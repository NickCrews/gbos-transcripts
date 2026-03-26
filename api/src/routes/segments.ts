import { Hono } from "hono";
import type { Db } from "../db/connection";
import { getSegmentById } from "../db/queries";

const segments = new Hono<{ Variables: { db: Db } }>();

// GET /api/v1/segments/:id
segments.get("/:id", async (c) => {
  const db = c.get("db");
  const id = Number(c.req.param("id"));

  if (!Number.isInteger(id) || id < 1) {
    return c.json({ error: "Invalid segment ID" }, 400);
  }

  const segment = await getSegmentById(db, id);
  if (!segment) {
    return c.json({ error: "Segment not found" }, 404);
  }

  return c.json(segment);
});

// GET /api/v1/segments/:id/audio
// Returns metadata for the audio clip (actual streaming requires ffmpeg integration)
segments.get("/:id/audio", async (c) => {
  const db = c.get("db");
  const id = Number(c.req.param("id"));

  if (!Number.isInteger(id) || id < 1) {
    return c.json({ error: "Invalid segment ID" }, 400);
  }

  const segment = await getSegmentById(db, id);
  if (!segment) {
    return c.json({ error: "Segment not found" }, 404);
  }

  // Return clip metadata; actual audio serving via ffmpeg is out of scope for this route
  return c.json({
    segmentId: id,
    meetingId: segment.meetingId,
    startTime: segment.startTime,
    endTime: segment.endTime,
    durationSecs: segment.durationSecs,
  });
});

export default segments;
