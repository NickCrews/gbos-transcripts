import { describe, it, expect, beforeEach } from "vitest";
import { inArray } from "drizzle-orm";
import { getDb, meetingsTable, segmentsTable, peopleTable, municipalitiesTable } from "@gbos/core/db";
import { addNewVideos, getMeetingTodos, processOneMeeting } from "./process";

describe("Pipeline Process E2E", () => {
    const { db } = getDb();

    beforeEach(async () => {
        // Clear the DB in order of dependencies
        await db.delete(segmentsTable);
        await db.delete(meetingsTable);
        await db.delete(peopleTable);
        await db.delete(municipalitiesTable);
    });

    it.fails("should process meetings through the full pipeline", { timeout: 600_000 }, async () => {
        const goldenVideos = [
            { id: "YAllijlxd1g", title: "Girdwood Board of Supervisors Special Meeting March 5, 2026" },
            { id: "9HoIM5INxpI", title: "Girdwood Board of Supervisors Regular Meeting March 23, 2026" },
        ];

        const added = await addNewVideos(db);
        expect(added.length).toBeGreaterThanOrEqual(goldenVideos.length);

        // 2. ensure that this golden list is a subset of the added videos
        const missings = goldenVideos.filter(g => !added.some(a => a.youtube_id === g.id));
        expect(missings).toEqual([]);

        const goldenIds = goldenVideos.map(g => g.id);
        const goldenMeetings = await db
            .select({ id: meetingsTable.id, youtube_id: meetingsTable.youtube_id })
            .from(meetingsTable)
            .where(inArray(meetingsTable.youtube_id, goldenIds));

        expect(goldenMeetings.length).toBe(goldenVideos.length);

        // 3. run getMeetingTodos()
        const allTodos = await getMeetingTodos(db);

        // 4. ensure seeded aligned meetings are present in todos
        const missings2 = goldenVideos.filter(g => !allTodos.some(t => t.youtube_id === g.id));
        expect(missings2).toEqual([]);

        // 5. for each of the golden todos, run processOneMeeting()
        const todos = allTodos.filter(t => goldenVideos.some(g => g.id === t.youtube_id));
        for (const todo of todos) {
            await processOneMeeting(db, todo);
        }

        // 6. verify golden meetings were fully embedded
        const finalGoldenMeetings = await db
            .select({ youtube_id: meetingsTable.youtube_id, status: meetingsTable.status })
            .from(meetingsTable)
            .where(inArray(meetingsTable.youtube_id, goldenIds));

        for (const m of finalGoldenMeetings) {
            expect(m.status).toBe("embedded");
        }

        const finalGoldenSegments = await db
            .select({ meeting_id: segmentsTable.meeting_id, text_embedding: segmentsTable.text_embedding })
            .from(segmentsTable)
            .where(inArray(segmentsTable.meeting_id, goldenMeetings.map(m => m.id)));

        expect(finalGoldenSegments.length).toBeGreaterThan(0);
        expect(finalGoldenSegments.every(s => s.text_embedding !== null)).toBe(true);
        await db.select().from(peopleTable);
    });
});
