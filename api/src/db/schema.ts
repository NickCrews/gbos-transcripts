/**
 * Drizzle ORM schema — mirrors the SQLite schema created by db.py.
 * This is the source of truth for the API side.
 */

import { sql } from "drizzle-orm";
import {
  integer,
  real,
  sqliteTable,
  text,
  blob,
} from "drizzle-orm/sqlite-core";

// ---------------------------------------------------------------------------
// municipalities
// ---------------------------------------------------------------------------
export const municipalities = sqliteTable("municipalities", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  shortName: text("short_name").notNull().unique(),
  state: text("state"),
  country: text("country").default("US"),
  youtubeChannelUrl: text("youtube_channel_url"),
  websiteUrl: text("website_url"),
  createdAt: text("created_at").default(sql`(datetime('now'))`),
});

// ---------------------------------------------------------------------------
// people
// ---------------------------------------------------------------------------
export const people = sqliteTable("people", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  voiceEmbedding: blob("voice_embedding"),
  voiceSampleCount: integer("voice_sample_count").default(0),
  createdAt: text("created_at").default(sql`(datetime('now'))`),
  updatedAt: text("updated_at").default(sql`(datetime('now'))`),
});

// ---------------------------------------------------------------------------
// roles
// ---------------------------------------------------------------------------
export const roles = sqliteTable("roles", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  personId: integer("person_id")
    .notNull()
    .references(() => people.id),
  municipalityId: integer("municipality_id")
    .notNull()
    .references(() => municipalities.id),
  role: text("role").notNull(),
  title: text("title"),
  startDate: text("start_date"),
  endDate: text("end_date"),
  createdAt: text("created_at").default(sql`(datetime('now'))`),
});

// ---------------------------------------------------------------------------
// meetings
// ---------------------------------------------------------------------------
export const meetings = sqliteTable("meetings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  municipalityId: integer("municipality_id")
    .notNull()
    .references(() => municipalities.id),
  youtubeId: text("youtube_id").notNull().unique(),
  title: text("title").notNull(),
  meetingDate: text("meeting_date"),
  meetingType: text("meeting_type"),
  durationSecs: real("duration_secs"),
  youtubeUrl: text("youtube_url").generatedAlwaysAs(
    sql`('https://www.youtube.com/watch?v=' || youtube_id)`,
    { mode: "stored" }
  ),
  audioPath: text("audio_path"),
  transcriptPath: text("transcript_path"),
  status: text("status").default("pending"),
  errorMessage: text("error_message"),
  createdAt: text("created_at").default(sql`(datetime('now'))`),
  updatedAt: text("updated_at").default(sql`(datetime('now'))`),
});

// ---------------------------------------------------------------------------
// agenda_items
// ---------------------------------------------------------------------------
export const agendaItems = sqliteTable("agenda_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  meetingId: integer("meeting_id")
    .notNull()
    .references(() => meetings.id),
  itemNumber: text("item_number"),
  title: text("title").notNull(),
  itemType: text("item_type"),
  startTime: real("start_time"),
  endTime: real("end_time"),
  durationSecs: real("duration_secs"),
  createdAt: text("created_at").default(sql`(datetime('now'))`),
});

// ---------------------------------------------------------------------------
// segments
// ---------------------------------------------------------------------------
export const segments = sqliteTable("segments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  meetingId: integer("meeting_id")
    .notNull()
    .references(() => meetings.id),
  agendaItemId: integer("agenda_item_id").references(() => agendaItems.id),
  personId: integer("person_id").references(() => people.id),
  speakerLabel: text("speaker_label"),
  text: text("text").notNull(),
  startTime: real("start_time").notNull(),
  endTime: real("end_time").notNull(),
  durationSecs: real("duration_secs").generatedAlwaysAs(
    sql`(end_time - start_time)`,
    { mode: "stored" }
  ),
  confidence: real("confidence"),
  createdAt: text("created_at").default(sql`(datetime('now'))`),
});

// ---------------------------------------------------------------------------
// summaries
// ---------------------------------------------------------------------------
export const summaries = sqliteTable("summaries", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  meetingId: integer("meeting_id")
    .notNull()
    .references(() => meetings.id),
  agendaItemId: integer("agenda_item_id").references(() => agendaItems.id),
  summaryText: text("summary_text").notNull(),
  modelUsed: text("model_used"),
  createdAt: text("created_at").default(sql`(datetime('now'))`),
});

// ---------------------------------------------------------------------------
// subscriptions
// ---------------------------------------------------------------------------
export const subscriptions = sqliteTable("subscriptions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  query: text("query").notNull(),
  mode: text("mode").default("hybrid"),
  webhookUrl: text("webhook_url"),
  email: text("email"),
  municipalityId: integer("municipality_id").references(
    () => municipalities.id
  ),
  createdAt: text("created_at").default(sql`(datetime('now'))`),
  lastNotifiedAt: text("last_notified_at"),
});
