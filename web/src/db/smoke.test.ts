import { afterAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { client, db } from './index';

describe('db smoke test', () => {
    afterAll(async () => {
        await client.end();
    });

    it('connects and returns a result', async () => {
        const result = await db.execute(sql`SELECT 1 AS value`);
        expect(result[0].value).toBe(1);
    });
});
