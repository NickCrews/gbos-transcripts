import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { relations } from "./schema";

export function getDb(url?: string) {
    url ??= process.env.DATABASE_URL;
    if (!url) {
        throw new Error("Must provide DATABASE_URL in environment variables or as an argument to getDb");
    }
    const client = postgres(url);
    const db = drizzle({ client, relations });
    return { db, client };
}

export type DB = ReturnType<typeof getDb>["db"];

export * from "./schema";
