import { pgLiteClient } from "./index.ts";

console.log("Ensuring vector extension is available in PGlite...");
const result = await pgLiteClient.exec(`CREATE EXTENSION IF NOT EXISTS vector;`)
console.log("Vector extension ensured:", result);