import { PGlite, type PGliteOptions } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { relations } from './schema';

// export type DbSchema = typeof schema;

// In-memory Postgres for development and testing
const options: PGliteOptions = {
    dataDir: "./.pglite/",
    extensions: { vector },
};
const pgLiteClient = new PGlite(options);
const db = drizzle({ client: pgLiteClient, relations });


export { db, pgLiteClient };