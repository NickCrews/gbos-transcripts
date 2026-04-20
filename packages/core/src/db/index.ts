import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { relations } from "./schema";

const client = postgres(process.env.DATABASE_URL!);
const db = drizzle({ client, relations });

export type DB = typeof db;

export { db, client };
export * from "./schema";
