import { Hono } from "hono";
import type { Db } from "../db/connection";
import {
  getPersonById,
  getPersonSegments,
  listPeople,
} from "../db/queries";

const people = new Hono<{ Variables: { db: Db } }>();

// GET /api/v1/people
people.get("/", async (c) => {
  const db = c.get("db");
  const query = c.req.query();

  const result = await listPeople(db, {
    role: query.role,
    municipality: query.municipality,
    page: query.page ? Number(query.page) : undefined,
    limit: query.limit ? Number(query.limit) : undefined,
  });

  return c.json(result);
});

// GET /api/v1/people/:id
people.get("/:id", async (c) => {
  const db = c.get("db");
  const id = Number(c.req.param("id"));

  if (!Number.isInteger(id) || id < 1) {
    return c.json({ error: "Invalid person ID" }, 400);
  }

  const person = await getPersonById(db, id);
  if (!person) {
    return c.json({ error: "Person not found" }, 404);
  }

  // Don't expose voice embedding blob in the API response
  const { voiceEmbedding: _, ...safe } = person;
  return c.json(safe);
});

// GET /api/v1/people/:id/segments
people.get("/:id/segments", async (c) => {
  const db = c.get("db");
  const id = Number(c.req.param("id"));
  const query = c.req.query();

  if (!Number.isInteger(id) || id < 1) {
    return c.json({ error: "Invalid person ID" }, 400);
  }

  const person = await getPersonById(db, id);
  if (!person) {
    return c.json({ error: "Person not found" }, 404);
  }

  const result = await getPersonSegments(db, id, {
    meetingId: query.meeting_id ? Number(query.meeting_id) : undefined,
    page: query.page ? Number(query.page) : undefined,
    limit: query.limit ? Number(query.limit) : undefined,
  });

  return c.json(result);
});

export default people;
