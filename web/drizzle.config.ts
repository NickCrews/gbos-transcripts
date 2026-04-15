import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';
import { pgLiteClient } from './src/db/index';

export default defineConfig({
    schema: './src/db/schema.ts',
    out: './src/db/migrations/',
    dialect: 'postgresql',
    driver: "pglite",
    dbCredentials: {
        driver: "pglite",
        client: pgLiteClient,
    },
});
