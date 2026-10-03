import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import { migrate as migratePostgres } from "drizzle-orm/postgres-js/migrator";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import postgres from "postgres";
import * as schema from "./schema";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

// Resolved from the project root: scripts run there via pnpm, and Next bundles this file elsewhere.
const migrationsFolder = path.resolve(process.cwd(), "drizzle");

export function loadEnv() {
  try {
    process.loadEnvFile(".env");
  } catch {
    // No .env file: rely on the process environment.
  }
}

/**
 * Supabase Postgres when DATABASE_URL is set; otherwise an in-process PGlite database (fresh per process).
 * Migrations are applied on open either way.
 */
export async function openDb(): Promise<{ db: Db; kind: "postgres" | "pglite"; close: () => Promise<void> }> {
  loadEnv();
  const url = process.env.DATABASE_URL;
  if (url) {
    // prepare: false keeps the Supabase transaction pooler happy.
    const client = postgres(url, { prepare: false, max: 1, onnotice: () => {} });
    const db = drizzlePostgres({ client, schema });
    await migratePostgres(db, { migrationsFolder });
    return { db, kind: "postgres", close: () => client.end() };
  }
  const client = new PGlite();
  const db = drizzlePglite({ client, schema });
  await migratePglite(db, { migrationsFolder });
  return { db, kind: "pglite", close: () => client.close() };
}
