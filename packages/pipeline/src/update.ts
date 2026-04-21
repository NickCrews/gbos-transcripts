import { getDb } from "@gbos/core/db";
import { addNewVideos, getMeetingTodos, processOneMeeting } from "./process";
import { loadEnv } from "./env";

async function main() {
  loadEnv();
  const { db, client } = getDb();
  console.log("=== GBOS Pipeline ===");
  try {
    await addNewVideos(db);
    const todos = await getMeetingTodos(db);
    for (const todo of todos) {
      await processOneMeeting(db, todo);
    }
    await client.end();
  } catch (err) {
    console.error(`  ✗ Failed: ${err}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
