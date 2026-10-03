import { connection } from "next/server";
import { sql } from "drizzle-orm";
import { configReport } from "@/server/config";
import { getDb } from "@/server/context";
import { redactSecrets } from "@/server/env";

export const maxDuration = 30;

/**
 * Deployment check: is the app running, is the database reachable and migrated, and which of the optional
 * integrations (model provider, GitHub) are configured. Statuses only — no credentials, and any error text is
 * redacted before it leaves the server.
 *
 * 200: this server can do what its configuration claims. 503: it is running but something is wrong.
 */
export async function GET() {
  await connection();

  let report: ReturnType<typeof configReport> | null = null;
  let configError: string | null = null;
  try {
    report = configReport();
  } catch (err) {
    configError = redact(err);
  }

  // getDb() opens the database, applies migrations and seeds the demo project, so a successful query here
  // means the whole startup path works.
  let database: { connected: boolean; kind: string | null; persistent: boolean; error: string | null } = {
    connected: false,
    kind: report?.storage.kind ?? null,
    persistent: report?.storage.persistent ?? false,
    error: null,
  };
  try {
    const { db, kind } = await getDb();
    await db.execute(sql`select 1`);
    database = { ...database, connected: true, kind };
  } catch (err) {
    database.error = redact(err);
  }

  const problems = [...(configError ? [configError] : []), ...(report?.problems ?? [])];
  const ok = database.connected && problems.length === 0;

  return Response.json(
    {
      ok,
      app: "architect-2.0",
      deployment: report?.deployment ?? null,
      database,
      // GitHub is optional, so it is reported but never decides `ok`.
      agents: report?.agents ?? null,
      proposer: report?.proposer ?? null,
      judge: report?.judge ?? null,
      github: report ? { configured: report.github.configured, repositories: report.github.repositories.length, problems: report.github.problems } : null,
      problems,
    },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}

function redact(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  try {
    return redactSecrets(message);
  } catch {
    // redactSecrets reads the environment, which is itself what failed: say nothing more than the error's shape.
    return err instanceof Error ? err.name : "unknown error";
  }
}
