import { after } from "next/server";
import { eq } from "drizzle-orm";
import { openDb, type Db } from "@/db/client";
import { projects } from "@/db/schema";
import { emit } from "@/events";
import {
  configuredProjectSlug,
  hasDefinition,
  projectDefinition,
  projectRuntime,
  runtimeFromRow,
  type ProjectRow,
} from "@/projects/registry";
import type { ProjectRuntime } from "@/projects/types";
import type { ModelMode } from "@/runtime/models";
import type { JudgeMode } from "@/scenarios/assertions";
import { serverEnv } from "@/server/env";

type Context = { db: Db; kind: "postgres" | "pglite" };

/** One DB handle per server process; kept on globalThis so dev hot-reloads don't open a fresh PGlite. */
const g = globalThis as unknown as {
  __architectDb?: Promise<Context>;
  __architectBusy?: string | null;
  __architectRuntime?: Map<string, ProjectRuntime>;
};

export function getDb(): Promise<Context> {
  g.__architectDb ??= openDb().then(async ({ db, kind }) => {
    await bootstrapProject(db);
    return { db, kind };
  });
  return g.__architectDb;
}

/**
 * The configured project, resolved from its definition: tool registry, simulator, example copy. Pure
 * configuration — no database — so it is safe to call from anywhere on the server. Cached per process because
 * building the registry converts each tool's input schema to JSON Schema.
 */
export function getRuntime(slug: string = configuredProjectSlug()): ProjectRuntime {
  const cache = (g.__architectRuntime ??= new Map());
  let runtime = cache.get(slug);
  if (!runtime) {
    runtime = projectRuntime(slug);
    cache.set(slug, runtime);
  }
  return runtime;
}

/**
 * Creates the configured project's rows if they are absent. An explicit bootstrap, not something every request
 * implies: the in-process database starts empty on each cold start, so the seeded demo still appears by itself.
 */
export async function bootstrapProject(db: Db, opts?: { reset?: boolean; slug?: string }): Promise<string> {
  return projectDefinition(opts?.slug).seed(db, { reset: opts?.reset });
}

// ---- Which project a request is about ------------------------------------------------------------------------

/** A persisted project, with everything the engine needs to run it. */
export type ResolvedProject = { id: string; slug: string; name: string; row: ProjectRow; runtime: ProjectRuntime };

/** A request named a project this server doesn't have. */
export class ProjectNotFound extends Error {}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Memoized for projects backed by a definition, since building a tool registry isn't free; free otherwise. */
function runtimeFor(row: ProjectRow): ProjectRuntime {
  return hasDefinition(row.slug) ? getRuntime(row.slug) : runtimeFromRow(row);
}

const resolved = (row: ProjectRow): ResolvedProject => ({
  id: row.id,
  slug: row.slug,
  name: row.name,
  row,
  runtime: runtimeFor(row),
});

async function findProject(db: Db, selector: string): Promise<ProjectRow | undefined> {
  const [row] = await db
    .select()
    .from(projects)
    .where(UUID.test(selector) ? eq(projects.id, selector) : eq(projects.slug, selector));
  return row;
}

/**
 * The project a request is about: the one it names, by id or slug, or else the configured one — which is
 * bootstrapped if this database has never seen it. Every route resolves its project this way, so a project
 * created from a brief and the seeded reference project arrive at the engine on identical terms.
 */
export async function resolveProject(db: Db, selector?: string | null): Promise<ResolvedProject> {
  const wanted = selector?.trim();
  if (wanted) {
    const row = await findProject(db, wanted);
    if (!row) throw new ProjectNotFound("That project doesn't exist on this server.");
    return resolved(row);
  }
  const slug = configuredProjectSlug();
  const row = (await findProject(db, slug)) ?? (await findProject(db, await bootstrapProject(db)));
  if (!row) throw new ProjectNotFound(`The configured project "${slug}" could not be opened.`);
  return resolved(row);
}

/** The project a change, revision or run already belongs to. */
export async function projectById(db: Db, id: string): Promise<ResolvedProject> {
  const row = await findProject(db, id);
  if (!row) throw new ProjectNotFound("That project doesn't exist on this server.");
  return resolved(row);
}

/** `?project=` — a project id or slug. Absent means the configured project. */
export function projectSelector(req: Request): string | null {
  return new URL(req.url).searchParams.get("project");
}

export function getModes(): { mode: ModelMode; judge: JudgeMode } {
  const env = serverEnv();
  const live = env.ARCHITECT_MODEL_MODE === "live";
  return {
    mode: live ? "live" : "fixture",
    judge: live || env.ARCHITECT_JUDGE === "live" ? "live" : "skip",
  };
}

/** Model modes plus the project to run: the options every run and verification takes. */
export function getRunOptions(runtime: ProjectRuntime): { mode: ModelMode; judge: JudgeMode; runtime: ProjectRuntime } {
  return { ...getModes(), runtime };
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
