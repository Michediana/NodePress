import { db, ensureMigrated } from "../app/.server/db";

await ensureMigrated();
console.log("Migrazioni applicate.");
await db.$client.end();
