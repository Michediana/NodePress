import path from "node:path";
import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";
import mysql from "mysql2/promise";
import { env } from "../env";
import * as schema from "./schema";

declare global {
  // Riutilizza il pool tra i reload HMR in sviluppo.
  var __nodepressPool: mysql.Pool | undefined;
  var __nodepressMigrated: Promise<void> | undefined;
}

function createPool() {
  const created = mysql.createPool({ uri: env.databaseUrl, connectionLimit: 10, timezone: "Z" });
  // Le date sono in UTC sia nel driver sia nei default SQL (CURRENT_TIMESTAMP).
  created.pool.on("connection", (connection) => {
    connection.query("SET time_zone = '+00:00'");
  });
  return created;
}

const pool = globalThis.__nodepressPool ?? createPool();
globalThis.__nodepressPool = pool;

export const db = drizzle(pool, { schema, mode: "default" });
export type Db = typeof db;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Applica le migrazioni Drizzle una sola volta per processo. */
export function ensureMigrated() {
  globalThis.__nodepressMigrated ??= migrate(db, {
    migrationsFolder: path.resolve("drizzle"),
  }).catch((error) => {
    globalThis.__nodepressMigrated = undefined;
    throw error;
  });
  return globalThis.__nodepressMigrated;
}

export { schema };
