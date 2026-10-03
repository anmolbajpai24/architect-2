import { after } from "next/server";
import { openDb, type Db } from "@/db/client";
import { emit } from "@/events";
import type { ModelMode } from "@/runtime/models";
import type { JudgeMode } from "@/scenarios/assertions";
import { seedDemo } from "@/seed";

type Context = { db: Db; kind: "postgres" | "pglite" };

/** One DB handle per server process; kept on globalThis so dev hot-reloads don't open a fresh PGlite. */
const g = globalThis as unknown as { __architectDb?: Promise<Context>; __architectBusy?: string | null };

export function getDb(): Promise<Context> {
  g.__architectDb ??= openDb().then(async ({ db, kind }) => {
    await seedDemo(db);
    return { db, kind };
  });
  return g.__architectDb;
}

/** The single demo project (seeded on first use). */
export async function getProjectId(db: Db): Promise<string> {
  return seedDemo(db);
}

export function getModes(): { mode: ModelMode; judge: JudgeMode } {
  const live = process.env.ARCHITECT_MODEL_MODE === "live";
  return {
    mode: live ? "live" : "fixture",
    judge: live || process.env.ARCHITECT_JUDGE === "live" ? "live" : "skip",
  };
}

/** Label of the background job in flight, if any. One at a time keeps the demo's runs unambiguous. */
export function busyJob(): string | null {
  return g.__architectBusy ?? null;
}

/**
 * Runs `job` after the response is sent. Progress reaches the client through the events table;
 * a crash is recorded as a `job.failed` event instead of leaving the UI waiting.
 */
export function startJob(db: Db, projectId: string, label: string, job: () => Promise<unknown>): boolean {
  if (busyJob()) return false;
  g.__architectBusy = label;
  after(async () => {
    try {
      await job();
    } catch (err) {
      await emit(db, {
        projectId,
        type: "job.failed",
        payload: { job: label, message: err instanceof Error ? err.message : String(err) },
      });
    } finally {
      g.__architectBusy = null;
    }
  });
  return true;
}
