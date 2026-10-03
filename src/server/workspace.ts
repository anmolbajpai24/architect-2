import { desc, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import {
  agents,
  agentVersions,
  changes,
  events,
  projects,
  runs,
  type ChangeExplanation,
  type ChangeStatus,
  type StructuralCheck,
} from "@/db/schema";
import type { AgentConfig, Assertion, ScenarioInput, ScenarioResult } from "@/domain/schemas";
import { SUGGESTED_INTENTS } from "@/changes/proposer";
import { loadScenarios } from "@/scenarios/runner";
import { busyJob, getModes } from "./context";

export type VersionStatus = "live" | "proposed" | "verified" | "rejected" | "superseded";

export type WorkspaceVersion = {
  id: string;
  version: number;
  config: AgentConfig;
  changeId: string | null;
  status: VersionStatus;
  createdAt: string;
};

export type WorkspaceAgent = {
  id: string;
  key: string;
  name: string;
  role: string;
  entry: boolean;
  currentVersionId: string | null;
  versions: WorkspaceVersion[]; // newest first
};

export type WorkspaceScenario = {
  id: string;
  key: string;
  name: string;
  intent: string;
  input: ScenarioInput;
  assertions: Assertion[];
};

export type WorkspaceChange = {
  id: string;
  intent: string;
  status: ChangeStatus;
  parentChangeId: string | null;
  resolution: string | null;
  baseVersionIds: Record<string, string>;
  proposedVersionIds: Record<string, string>;
  structural: StructuralCheck[] | null;
  explanation: ChangeExplanation | null;
  createdAt: string;
};

export type WorkspaceRun = {
  id: string;
  trigger: "manual" | "change";
  status: "running" | "passed" | "failed";
  changeId: string | null;
  modelMode: "fixture" | "live";
  versionIds: Record<string, string>;
  results: ScenarioResult[] | null;
  startedAt: string;
  finishedAt: string | null;
};

export type WorkspaceEvent = {
  seq: number;
  type: string;
  runId: string | null;
  changeId: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type WorkspaceSnapshot = {
  project: { id: string; name: string; slug: string };
  env: { db: "postgres" | "pglite"; mode: "fixture" | "live"; judge: "skip" | "live" };
  busy: string | null;
  suggestedIntents: string[];
  agents: WorkspaceAgent[];
  scenarios: WorkspaceScenario[];
  changes: WorkspaceChange[]; // newest first
  runs: WorkspaceRun[]; // newest first
  events: WorkspaceEvent[]; // oldest first
  lastSeq: number;
};

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export function toWorkspaceEvent(e: typeof events.$inferSelect): WorkspaceEvent {
  return {
    seq: e.seq,
    type: e.type,
    runId: e.runId,
    changeId: e.changeId,
    payload: e.payload,
    createdAt: e.createdAt.toISOString(),
  };
}

/** Everything the workspace renders, in one read. Live progress arrives separately over SSE. */
export async function getWorkspace(db: Db, projectId: string, dbKind: "postgres" | "pglite"): Promise<WorkspaceSnapshot> {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  const agentRows = await db.select().from(agents).where(eq(agents.projectId, projectId)).orderBy(agents.createdAt);
  const versionRows = agentRows.length
    ? await db
        .select()
        .from(agentVersions)
        .where(
          inArray(
            agentVersions.agentId,
            agentRows.map((a) => a.id),
          ),
        )
        .orderBy(desc(agentVersions.version))
    : [];
  const changeRows = await db
    .select()
    .from(changes)
    .where(eq(changes.projectId, projectId))
    .orderBy(desc(changes.createdAt));
  const runRows = await db
    .select()
    .from(runs)
    .where(eq(runs.projectId, projectId))
    .orderBy(desc(runs.startedAt))
    .limit(20);
  const eventRows = await db
    .select()
    .from(events)
    .where(eq(events.projectId, projectId))
    .orderBy(desc(events.seq))
    .limit(80);
  const scenarioRows = await loadScenarios(db, projectId);
  const [latestEvent] = await db.select({ seq: events.seq }).from(events).orderBy(desc(events.seq)).limit(1);

  const changeStatus = new Map(changeRows.map((c) => [c.id, c.status]));
  const handoffTargets = new Set<string>();

  const workspaceAgents: WorkspaceAgent[] = agentRows.map((a) => {
    const versions = versionRows
      .filter((v) => v.agentId === a.id)
      .map((v): WorkspaceVersion => {
        const origin = v.changeId ? changeStatus.get(v.changeId) : undefined;
        const status: VersionStatus =
          v.id === a.currentVersionId
            ? "live"
            : origin === "structural_failed" || origin === "behavioral_failed"
              ? "rejected"
              : origin === "proposed" || origin === "verified"
                ? origin
                : "superseded";
        return {
          id: v.id,
          version: v.version,
          config: v.config,
          changeId: v.changeId,
          status,
          createdAt: v.createdAt.toISOString(),
        };
      });
    const live = versions.find((v) => v.status === "live") ?? versions[versions.length - 1];
    live?.config.handoffs.forEach((h) => handoffTargets.add(h));
    return {
      id: a.id,
      key: a.key,
      name: a.name,
      role: live?.config.role ?? "",
      entry: false,
      currentVersionId: a.currentVersionId,
      versions,
    };
  });
  workspaceAgents.forEach((a) => (a.entry = !handoffTargets.has(a.key)));

  return {
    project: { id: project.id, name: project.name, slug: project.slug },
    env: { db: dbKind, ...getModes() },
    busy: busyJob(),
    suggestedIntents: SUGGESTED_INTENTS,
    agents: workspaceAgents,
    scenarios: scenarioRows.map((s) => ({
      id: s.id,
      key: s.key,
      name: s.name,
      intent: s.intent,
      input: s.input,
      assertions: s.assertions,
    })),
    changes: changeRows.map((c) => ({
      id: c.id,
      intent: c.intent,
      status: c.status,
      parentChangeId: c.parentChangeId,
      resolution: c.resolution,
      baseVersionIds: c.baseVersionIds,
      proposedVersionIds: c.proposedVersionIds,
      structural: c.structural,
      explanation: c.explanation,
      createdAt: c.createdAt.toISOString(),
    })),
    runs: runRows.map((r) => ({
      id: r.id,
      trigger: r.trigger,
      status: r.status,
      changeId: r.changeId,
      modelMode: r.modelMode,
      versionIds: r.versionIds,
      results: r.results,
      startedAt: r.startedAt.toISOString(),
      finishedAt: iso(r.finishedAt),
    })),
    events: eventRows.reverse().map(toWorkspaceEvent),
    lastSeq: latestEvent?.seq ?? 0,
  };
}
