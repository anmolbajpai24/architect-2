import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import { migrate as migratePostgres } from "drizzle-orm/postgres-js/migrator";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import postgres from "postgres";
import * as schema from "./schema";
import { ConfigError, isManagedDeployment, loadServerEnv } from "@/server/env";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
export type DbKind = "postgres" | "pglite";

// Resolved from the project root: scripts run there via pnpm, and Next bundles this file elsewhere.
// On Vercel the folder is part of the function's traced files, next to the bundle, so the same path resolves.
const migrationsFolder = path.resolve(process.cwd(), "drizzle");

export const loadEnv = loadServerEnv;

/**
 * One Drizzle schema, two engines:
 *
 * - `DATABASE_URL` set → Postgres (Supabase) over postgres.js. This is the only durable, shared option, and the
 *   only one that makes sense when more than one server process can serve a request.
 * - unset → an in-process PGlite database, fresh per process. Zero-setup local development and the offline demo.
 *
 * Migrations in `drizzle/` are applied when the database is opened, so a cold start is enough to bring a new
 * deployment up to date. See docs/DEPLOYMENT.md for the concurrency caveat on a managed host.
 */
export async function openDb(): Promise<{ db: Db; kind: DbKind; close: () => Promise<void> }> {
  loadEnv();
  if (!fs.existsSync(path.join(migrationsFolder, "meta", "_journal.json"))) {
    throw new ConfigError(`Database migrations are missing: expected them in ${migrationsFolder}.`);
  }
  const url = process.env.DATABASE_URL?.trim();
  if (url) {
    // prepare: false keeps the Supabase transaction pooler happy; a small pool keeps a replaceable
    // serverless instance from holding more pooler connections than it can use.
    const client = postgres(url, {
      prepare: false,
      max: 3,
      idle_timeout: 20,
      connect_timeout: 10,
      onnotice: () => {},
    });
    const db = drizzlePostgres({ client, schema });
    await migratePostgres(db, { migrationsFolder });
    return { db, kind: "postgres", close: () => client.end() };
  }
  if (isManagedDeployment() && !process.env.ARCHITECT_ALLOW_EPHEMERAL_DB) {
    // Not a fallback worth making silently: every instance would hold its own copy of the project, so a change
    // verified by one request could be invisible to the next.
    throw new ConfigError(
      "This deployment has no database. Set DATABASE_URL to a Postgres (Supabase) connection string. " +
        "The in-process database is for local development only; set ARCHITECT_ALLOW_EPHEMERAL_DB=1 to accept it here.",
    );
  }
  const client = new PGlite();
  const db = drizzlePglite({ client, schema });
  await migratePglite(db, { migrationsFolder });
  return { db, kind: "pglite", close: () => client.close() };
}
