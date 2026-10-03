import { desc, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import {
  agents,
  agentVersions,
  changeShipments,
  changes,
  events,
  projects,
  runs,
  scenarioVersions,
  type ChangeExplanation,
  type ChangeProposal,
  type ChangeStatus,
  type ScenarioProposal,
  type StructuralCheck,
} from "@/db/schema";
import { Assertion, type AgentConfig, type ScenarioInput, type ScenarioResult, type ToolResultSummary } from "@/domain/schemas";
import { proposerConfig } from "@/changes/proposer";
import { hasDefinition } from "@/projects/registry";
import { loadScenarios } from "@/scenarios/runner";
import { githubStatus, type GitHubStatus } from "@/github/config";
import { checkShipGate } from "@/shipping/gate";
import { configReport } from "./config";
import { busyJob, getModes, type ResolvedProject } from "./context";

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

/** live: the rule in force. proposed: drafted, awaiting the user. superseded: was live once. discarded: never applied. */
export type ScenarioVersionStatus = "live" | "proposed" | "superseded" | "discarded";

export type WorkspaceScenarioVersion = {
  id: string;
  version: number;
  status: ScenarioVersionStatus;
  name: string;
  intent: string;
  input: ScenarioInput;
  assertions: Assertion[];
  basedOnVersionId: string | null;
  changeId: string | null;
  request: string | null;
  proposal: ScenarioProposal | null;
  appliedAt: string | null;
  createdAt: string;
};

/** The live rule's content at the top level, plus the full history (newest first). */
export type WorkspaceScenario = {
  id: string;
  key: string;
  versionId: string;
  version: number;
  name: string;
  intent: string;
  input: ScenarioInput;
  assertions: Assertion[];
  versions: WorkspaceScenarioVersion[];
  /** Rule changes the user can suggest in fixture mode (empty in live mode: anything goes). */
  suggestedRuleChanges: string[];
};

/** GitHub provenance of a shipped (or shipping / failed) change. */
export type WorkspaceShipment = {
  status: "shipping" | "shipped" | "failed";
  repository: string;
  baseBranch: string | null;
  branch: string;
  commitSha: string | null;
  prNumber: number | null;
  prUrl: string | null;
  error: string | null;
  shippedAt: string | null;
  updatedAt: string;
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
  proposal: ChangeProposal | null;
  shipment: WorkspaceShipment | null;
  /** The server's ship gate, for applied changes only (null otherwise). The ship route enforces the same gate. */
  ship: { ready: boolean; reason: string | null } | null;
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

/** A registered tool, as the UI needs it: enough to label it and summarize what it returned. */
export type WorkspaceTool = {
  name: string;
  description: string;
  resultSummary: ToolResultSummary | null;
};

export type WorkspaceSnapshot = {
  project: {
    id: string;
    name: string;
    slug: string;
    /** Example copy for the free-text inputs, supplied by the project definition. Null means use generic text. */
    placeholders: { changeRequest: string | null; ruleChange: string | null };
    /** The project's registered tools. The UI renders tool results from this, never from a known shape. */
    tools: WorkspaceTool[];
    /** Where the entry agent's user-facing response lives in its output. Null means "find it generically". */
    responsePath: string | null;
    /** "definition": backed by code in src/projects (seedable, may have tools). "brief": created from a brief. */
    origin: "definition" | "brief";
    /** The brief this project was created from, when it was. */
    brief: string | null;
  };
  env: {
    db: "postgres" | "pglite";
    mode: "fixture" | "live";
    judge: "skip" | "live";
    proposer: { mode: "fixture" | "live"; model: string };
    github: GitHubStatus;
    /** Configuration this server can't honor (e.g. live models with no provider key). Variable names, never values. */
    problems: string[];
  };
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
export async function getWorkspace(
  db: Db,
  resolved: Pick<ResolvedProject, "id" | "slug" | "runtime">,
  dbKind: "postgres" | "pglite",
): Promise<WorkspaceSnapshot> {
  const projectId = resolved.id;
  const runtime = resolved.runtime;
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
  const scenarioVersionRows = scenarioRows.length
    ? await db
        .select()
        .from(scenarioVersions)
        .where(
          inArray(
            scenarioVersions.scenarioId,
            scenarioRows.map((s) => s.id),
          ),
        )
        .orderBy(desc(scenarioVersions.version))
    : [];
  const shipmentRows = await db.select().from(changeShipments).where(eq(changeShipments.projectId, projectId));
  const gates = new Map(
    await Promise.all(
      changeRows.filter((c) => c.status === "applied").map(async (c) => [c.id, await checkShipGate(db, c.id)] as const),
    ),
  );
  const [latestEvent] = await db.select({ seq: events.seq }).from(events).orderBy(desc(events.seq)).limit(1);

  const changeStatus = new Map(changeRows.map((c) => [c.id, c.status]));
  const proposer = proposerConfig();
  // Example requests and placeholder copy are the project's, not the engine's.
  const ruleChanges = runtime.suggestedRuleChanges?.(proposer.mode) ?? {};
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
    project: {
      id: project.id,
      name: project.name,
      slug: project.slug,
      placeholders: {
        changeRequest: runtime.placeholders?.changeRequest ?? null,
        ruleChange: runtime.placeholders?.ruleChange ?? null,
      },
      tools: runtime.tools.names.map((name) => ({
        name,
        description: runtime.tools.descriptions[name],
        resultSummary: runtime.tools.resultSummaries[name] ?? null,
      })),
      responsePath: runtime.responsePath ?? null,
      origin: hasDefinition(project.slug) ? "definition" : "brief",
      brief: project.brief,
    },
    env: { db: dbKind, ...getModes(), proposer, github: githubStatus(), problems: configReport(runtime).problems },
    busy: busyJob(),
    suggestedIntents: runtime.suggestedIntents?.(proposer.mode) ?? [],
    agents: workspaceAgents,
    scenarios: scenarioRows.map((s) => ({
      id: s.id,
      key: s.key,
      versionId: s.versionId,
      version: s.version,
      name: s.name,
      intent: s.intent,
      input: s.input,
      assertions: s.assertions,
      versions: scenarioVersionRows
        .filter((v) => v.scenarioId === s.id)
        .map(
          (v): WorkspaceScenarioVersion => ({
            id: v.id,
            version: v.version,
            status:
              v.id === s.versionId ? "live" : v.discardedAt ? "discarded" : v.appliedAt ? "superseded" : "proposed",
            name: v.name,
            intent: v.intent,
            input: v.input,
            assertions: Assertion.array().parse(v.assertions),
            basedOnVersionId: v.basedOnVersionId,
            changeId: v.changeId,
            request: v.request,
            proposal: v.proposal,
            appliedAt: iso(v.appliedAt),
            createdAt: v.createdAt.toISOString(),
          }),
        ),
      suggestedRuleChanges: ruleChanges[s.key] ?? [],
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
      proposal: c.proposal,
      shipment: (() => {
        const sh = shipmentRows.find((x) => x.changeId === c.id);
        return sh
          ? {
              status: sh.status,
              repository: sh.repository,
              baseBranch: sh.baseBranch,
              branch: sh.branch,
              commitSha: sh.commitSha,
              prNumber: sh.prNumber,
              prUrl: sh.prUrl,
              error: sh.error,
              shippedAt: iso(sh.shippedAt),
              updatedAt: sh.updatedAt.toISOString(),
            }
          : null;
      })(),
      ship: (() => {
        const gate = gates.get(c.id);
        return gate ? { ready: gate.ok, reason: gate.ok ? null : gate.reason } : null;
      })(),
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
