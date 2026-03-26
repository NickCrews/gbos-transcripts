import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { resolve } from "path";
import * as schema from "./schema";

const DB_PATH = resolve(
  import.meta.dirname ?? __dirname,
  "../../../data/gbos.db"
);

let _db: ReturnType<typeof drizzle> | null = null;

export function getDb(): ReturnType<typeof drizzle<typeof schema>> {
  if (_db) return _db as ReturnType<typeof drizzle<typeof schema>>;
  const sqlite = new Database(DB_PATH);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  _db = drizzle(sqlite, { schema });
  return _db as ReturnType<typeof drizzle<typeof schema>>;
}

export type Db = ReturnType<typeof getDb>;
