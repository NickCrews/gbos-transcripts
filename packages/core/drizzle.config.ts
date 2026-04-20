import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

config({ path: join(dirname(fileURLToPath(import.meta.url)), "../../.env.local") });

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations/",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
