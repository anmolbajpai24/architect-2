/**
 * pnpm db:migrate
 * Applies the Drizzle migrations in `drizzle/` to the database in DATABASE_URL (Supabase, or any Postgres).
 *
 * The server also migrates when it opens the database, so this script is for doing it deliberately — before a
 * deployment, or from a machine that can reach the database — rather than on a cold start under traffic.
 */
import { openDb } from "@/db/client";
import { loadServerEnv } from "@/server/env";

loadServerEnv();
if (!process.env.DATABASE_URL?.trim()) {
  console.error(
    "DATABASE_URL is not set. Set it to the Postgres connection string you want to migrate (for Supabase, the pooled one).\n" +
      "Without it, Architect runs on an in-process database that is created and migrated from scratch on every start.",
  );
  process.exit(1);
}

const { kind, close } = await openDb();
try {
  console.log(`Migrations applied · db: ${kind}`);
} finally {
  await close();
}
