import { afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "./index";

describe("db smoke test", () => {
  const { client, db } = getDb();

  afterAll(async () => {
    await client.end();
  });

  it("connects and returns a result", async () => {
    const [result] = await db.execute(sql`SELECT 1 AS value`);
    expect(result!.value).toBe(1);
  });
});
