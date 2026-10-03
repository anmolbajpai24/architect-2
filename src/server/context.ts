import { after } from "next/server";
import { openDb, type Db } from "@/db/client";
import { emit } from "@/events";
import type { ModelMode } from "@/runtime/models";
import type { JudgeMode } from "@/scenarios/assertions";
import { seedDemo } from "@/seed";
import { serverEnv } from "@/server/env";

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
  const env = serverEnv();
  const live = env.ARCHITECT_MODEL_MODE === "live";
  return {
    mode: live ? "live" : "fixture",
    judge: live || env.ARCHITECT_JUDGE === "live" ? "live" : "skip",
  };
}

/**
 * ---- Job serialization (prototype) --------------------------------------------------------------------------
 *
 * One job at a time, so a verification run and the agent versions it reads can't interleave with another one.
 * The lock lives in this process's memory. That is sound for a single server — `pnpm dev`, `pnpm start`, one
 * container — and it is the only part of Architect that is not safe to run on more than one instance: two Vercel
 * instances each see an empty lock and would both start a run.
 *
 * TODO (production): replace this with a lease in Postgres — a `job_leases` row claimed with a conditional
 * `update ... where expires_at < now()`, renewed by the worker, expiring if the instance dies — and move the job
 * body out of `after()` into a worker that survives the request. Nothing outside this block depends on where the
 * lock lives: `busyJob` / `claimBusy` / `startJob` is the whole surface. See docs/DEPLOYMENT.md.
 */

/** Label of the background job in flight, if any. One at a time keeps the demo's runs unambiguous. */
export function busyJob(): string | null {
  return g.__architectBusy ?? null;
}

/** Takes the one-job lock for work done inside a request (e.g. drafting). Returns a release function, or null if busy. */
export function claimBusy(label: string): (() => void) | null {
  if (busyJob()) return null;
  g.__architectBusy = label;
  return () => {
    if (g.__architectBusy === label) g.__architectBusy = null;
  };
}

/**
 * Runs `job` after the response is sent. Progress reaches the client through the events table;
 * a crash is recorded as a `job.failed` event instead of leaving the UI waiting.
 *
 * `after()` keeps the invocation alive until the job settles, but only up to the route's `maxDuration`. A job cut
 * off at that limit emits no event, so the run row stays unfinished — the prototype ceiling documented in
 * docs/DEPLOYMENT.md, and the reason live runs want a higher limit than fixture runs.
 */
export function startJob(db: Db, projectId: string, label: string, job: () => Promise<unknown>): boolean {
  if (!claimBusy(label)) return false;
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
