import type { Config } from "drizzle-kit";
import { resolve } from "path";

export default {
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: resolve(__dirname, "../data/gbos.db"),
  },
} satisfies Config;
