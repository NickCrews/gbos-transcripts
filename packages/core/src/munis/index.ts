import { DB, municipalitiesTable } from "../db";
import { eq } from "drizzle-orm";

export const GBOS_MUNICIPALITY = {
  name: "Girdwood Board of Supervisors",
  name_short: "GBOS",
  state: "AK",
  youtube_channel_id: "UCOUlNInprZEjhbpVPiJOlEA",
} as const;

export async function getOrCreateGbos(db: DB) {
  const [existing] = await db
    .select({ id: municipalitiesTable.id })
    .from(municipalitiesTable)
    .where(
      eq(
        municipalitiesTable.youtube_channel_id,
        GBOS_MUNICIPALITY.youtube_channel_id,
      ),
    )
    .limit(1);
  if (existing) return { id: existing.id, ...GBOS_MUNICIPALITY };

  const [created] = await db
    .insert(municipalitiesTable)
    .values(GBOS_MUNICIPALITY)
    .returning({ id: municipalitiesTable.id });
  return { id: created!.id, ...GBOS_MUNICIPALITY };
}
