import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { getDb } from "./db/connection";
import { municipalities } from "./db/schema";
import meetingsRouter from "./routes/meetings";
import searchRouter from "./routes/search";
import peopleRouter from "./routes/people";
import segmentsRouter from "./routes/segments";

const app = new Hono();

// Middleware
app.use("*", logger());
app.use("*", cors());

// Inject database into context
app.use("*", (c, next) => {
  c.set("db", getDb());
  return next();
});

// Routes
app.route("/api/v1/meetings", meetingsRouter);
app.route("/api/v1/search", searchRouter);
app.route("/api/v1/people", peopleRouter);
app.route("/api/v1/segments", segmentsRouter);

// GET /api/v1/municipalities
app.get("/api/v1/municipalities", async (c) => {
  const db = c.get("db");
  const rows = await db.query.municipalities.findMany();
  return c.json({ municipalities: rows });
});

// Health check
app.get("/health", (c) => c.json({ status: "ok" }));

export default app;

// Serve when run directly
if (import.meta.main ?? require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  console.log(`GBOS API listening on port ${port}`);
  const { serve } = await import("@hono/node-server");
  serve({ fetch: app.fetch, port });
}
