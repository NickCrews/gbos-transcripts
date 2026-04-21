import { describe, it, expect, beforeEach } from "vitest";
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

    it("should process meetings through the full pipeline", async () => {
        const goldenVideos = [
            { id: "YAllijlxd1g", title: "Girdwood Board of Supervisors Special Meeting March 5, 2026" },
            { id: "9HoIM5INxpI", title: "Girdwood Board of Supervisors Regular Meeting March 23, 2026" },
        ];

        const added = await addNewVideos(db);
        expect(added).toMatchSnapshot();

        // 2. ensure that this golden list is a subset of the added videos
        const missings = goldenVideos.filter(g => !added.some(a => a.youtube_id === g.id));
        expect(missings).toEqual([]);

        // 3. run getMeetingTodos()
        const allTodos = await getMeetingTodos(db);

        // 4. again, ensure this is a subset of the golden list
        const missings2 = goldenVideos.filter(g => !allTodos.some(t => t.youtube_id === g.id));
        expect(missings2).toEqual([]);

        // 5. for each of the golden todos, run processOneMeeting()
        const todos = allTodos.filter(t => goldenVideos.some(g => g.id === t.youtube_id));
        for (const todo of todos) {
            await processOneMeeting(db, todo);
        }

        // 6. inspect the db, and compare it to a snapshotted state.
        const finalMeetings = await db.select().from(meetingsTable).orderBy(meetingsTable.youtube_id);
        const finalSegments = await db.select().from(segmentsTable).orderBy(segmentsTable.id);
        const finalPeople = await db.select().from(peopleTable).orderBy(peopleTable.id);

        // Normalize: remove volatile fields like IDs and timestamps
        const normalize = (rows: any[]) => rows.map(r => {
            const { id, created_at, municipality_id, meeting_id, person_id, ...rest } = r;

            // Normalize intervals if they are objects
            if (rest.start_secs && typeof rest.start_secs === 'object') {
                rest.start_secs = JSON.stringify(rest.start_secs);
            }
            if (rest.end_secs && typeof rest.end_secs === 'object') {
                rest.end_secs = JSON.stringify(rest.end_secs);
            }
            if (rest.duration_secs && typeof rest.duration_secs === 'object') {
                rest.duration_secs = JSON.stringify(rest.duration_secs);
            }

            return rest;
        });

        // We use a custom matcher or just snapshot the normalized data
        // The user mentioned "fuzziness", so we'll be generous by only snapshotting the core data.
        expect(normalize(finalMeetings)).toMatchSnapshot();
        expect(normalize(finalSegments)).toMatchSnapshot();
        expect(normalize(finalPeople)).toMatchSnapshot();
    });
});
