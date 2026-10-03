import { and, desc, eq, inArray, max } from "drizzle-orm";
import type { Db } from "@/db/client";
import { agents, agentVersions, changes, runs, type ChangeExplanation, type ChangeProposal } from "@/db/schema";
import type { AgentConfig, ScenarioResult, VersionSet } from "@/domain/schemas";
import { emit } from "@/events";
import type { ModelMode } from "@/runtime/models";
import { describeAssertion, type JudgeMode } from "@/scenarios/assertions";
import { loadCurrentVersions, loadScenarios, runScenarios } from "@/scenarios/runner";
import { checkStructure } from "@/verify/structural";

/** Fields of an agent's config a Change replaces. Anything omitted is carried over from the base version. */
export type AgentEdit = Partial<AgentConfig>;

export type ProposeInput = {
  projectId: string;
  intent: string;
  edits: Record<string, AgentEdit>;
  parentChangeId?: string;
  proposal?: ChangeProposal;
};

/** Records the user's intent and writes one new immutable AgentVersion per edited agent. Nothing goes live yet. */
export async function proposeChange(db: Db, input: ProposeInput) {
  const current = await loadCurrentVersions(db, input.projectId);
  const agentRows = await db.select().from(agents).where(eq(agents.projectId, input.projectId));

  return db.transaction(async (tx) => {
    const [change] = await tx
      .insert(changes)
      .values({
        projectId: input.projectId,
        parentChangeId: input.parentChangeId ?? null,
        intent: input.intent,
        baseVersionIds: Object.fromEntries(Object.entries(current).map(([k, v]) => [k, v.versionId])),
        proposedVersionIds: {},
        proposal: input.proposal ?? null,
      })
      .returning();

    const proposedVersionIds: Record<string, string> = {};
    for (const [key, edit] of Object.entries(input.edits)) {
      const agent = agentRows.find((a) => a.key === key);
      if (!agent || !current[key]) throw new Error(`Change edits unknown agent "${key}"`);
      const [{ latest }] = await tx
        .select({ latest: max(agentVersions.version) })
        .from(agentVersions)
        .where(eq(agentVersions.agentId, agent.id));
      const [version] = await tx
        .insert(agentVersions)
        .values({
          agentId: agent.id,
          version: (latest ?? 0) + 1,
          config: { ...current[key].config, ...edit },
          changeId: change.id,
        })
        .returning();
      proposedVersionIds[key] = version.id;
    }

    const [proposed] = await tx
      .update(changes)
      .set({ proposedVersionIds, updatedAt: new Date() })
      .where(eq(changes.id, change.id))
      .returning();
    await emit(tx, {
      projectId: input.projectId,
      changeId: change.id,
      type: "change.created",
      payload: {
        intent: input.intent,
        agents: Object.keys(input.edits),
        parentChangeId: input.parentChangeId ?? null,
        proposal: input.proposal ?? null,
      },
    });
    return proposed;
  });
}

async function getChange(db: Db, changeId: string) {
  const [change] = await db.select().from(changes).where(eq(changes.id, changeId));
  if (!change) throw new Error(`Change ${changeId} not found`);
  return change;
}

/** Current versions with the change's proposed versions swapped in. */
async function candidateVersions(db: Db, change: Awaited<ReturnType<typeof getChange>>): Promise<VersionSet> {
  const current = await loadCurrentVersions(db, change.projectId);
  const ids = Object.values(change.proposedVersionIds);
  const rows = ids.length ? await db.select().from(agentVersions).where(inArray(agentVersions.id, ids)) : [];
  const candidate = { ...current };
  for (const [key, id] of Object.entries(change.proposedVersionIds)) {
    const row = rows.find((r) => r.id === id)!;
    candidate[key] = { versionId: row.id, config: row.config };
  }
  return candidate;
}

function lines(text: string) {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

/** Deterministic explanation: which protected intents broke, how, and what the change did to the instructions. */
function explainFailure(
  base: VersionSet,
  candidate: VersionSet,
  editedAgents: string[],
  results: ScenarioResult[],
  intents: Record<string, string>,
): ChangeExplanation {
  const failed = results.filter((r) => r.status !== "pass");
  const failures = failed.flatMap((r) =>
    r.assertions
      .filter((a) => a.status === "fail" || a.status === "error")
      .map((a) => ({
        scenario: r.name,
        intent: intents[r.scenarioKey],
        assertion: a.assertion.description ?? describeAssertion(a.assertion),
        expected: describeAssertion(a.assertion),
        actual: a.reason ?? JSON.stringify(a.actual ?? null),
      })),
  );
  const instructionDiff = editedAgents.map((agent) => {
    const before = lines(base[agent].config.instructions);
    const after = lines(candidate[agent].config.instructions);
    return {
      agent,
      removed: before.filter((l) => !after.includes(l)),
      added: after.filter((l) => !before.includes(l)),
    };
  });
  const removedCount = instructionDiff.reduce((n, d) => n + d.removed.length, 0);
  return {
    summary:
      `The configuration is structurally valid, but ${failed.length} scenario(s) now fail: ` +
      `${failed.map((r) => `"${r.name}"`).join(", ")}. ` +
      (removedCount
        ? `The change removed ${removedCount} instruction line(s) from ${editedAgents.join(", ")}; ` +
          `the failing scenario protects: "${intents[failed[0].scenarioKey]}".`
        : `The failing scenario protects: "${intents[failed[0].scenarioKey]}".`),
    failures,
    instructionDiff,
    options: [
      { id: "keep_rule_fix", label: "Keep the rule → Fix it" },
      { id: "change_rule", label: "Change the rule (update the scenario)" },
    ],
  };
}

export type VerifyOptions = { mode: ModelMode; judge: JudgeMode };

/** Structural check first; if that passes, run every scenario against the candidate system. */
export async function verifyChange(db: Db, changeId: string, opts: VerifyOptions) {
  const change = await getChange(db, changeId);
  const base = await loadCurrentVersions(db, change.projectId);
  const candidate = await candidateVersions(db, change);
  const scenarioRows = await loadScenarios(db, change.projectId);
  const ev = (type: string, payload: Record<string, unknown>) =>
    emit(db, { projectId: change.projectId, changeId, type, payload });

  const structural = checkStructure(candidate, scenarioRows);
  const structuralOk = structural.every((c) => c.ok);
  await ev("change.structural_checked", { ok: structuralOk, checks: structural });
  if (!structuralOk) {
    const [updated] = await db
      .update(changes)
      .set({ structural, status: "structural_failed", updatedAt: new Date() })
      .where(eq(changes.id, changeId))
      .returning();
    return { change: updated, structural, run: null };
  }

  const run = await runScenarios(db, {
    projectId: change.projectId,
    versions: candidate,
    trigger: "change",
    changeId,
    mode: opts.mode,
    judge: opts.judge,
  });

  const passed = run.status === "passed";
  const explanation = passed
    ? null
    : explainFailure(
        base,
        candidate,
        Object.keys(change.proposedVersionIds),
        run.results,
        Object.fromEntries(scenarioRows.map((s) => [s.key, s.intent])),
      );
  const [updated] = await db
    .update(changes)
    .set({ structural, explanation, status: passed ? "verified" : "behavioral_failed", updatedAt: new Date() })
    .where(eq(changes.id, changeId))
    .returning();
  await ev(passed ? "change.verified" : "change.behavioral_failed", { runId: run.id, explanation });
  return { change: updated, structural, run };
}

/** Moves each edited agent's current version to the proposed one. Only verified changes go live. */
export async function applyChange(db: Db, changeId: string) {
  const change = await getChange(db, changeId);
  if (change.status !== "verified") throw new Error(`Only verified changes can be applied (status: ${change.status})`);
  return db.transaction(async (tx) => {
    for (const [key, versionId] of Object.entries(change.proposedVersionIds)) {
      await tx
        .update(agents)
        .set({ currentVersionId: versionId })
        .where(and(eq(agents.projectId, change.projectId), eq(agents.key, key)));
    }
    const [applied] = await tx
      .update(changes)
      .set({ status: "applied", updatedAt: new Date() })
      .where(eq(changes.id, changeId))
      .returning();
    await emit(tx, {
      projectId: change.projectId,
      changeId,
      type: "change.applied",
      payload: { versionIds: change.proposedVersionIds },
    });
    return applied;
  });
}

/**
 * "Keep the rule → Fix it": the scenario stays as-is; a follow-up Change revises the failed one so the intent
 * is met without breaking the rule. The failed change is marked resolved and never goes live.
 */
export async function keepRuleAndFix(
  db: Db,
  failedChangeId: string,
  edits: Record<string, AgentEdit>,
  proposal?: ChangeProposal,
) {
  const failed = await getChange(db, failedChangeId);
  if (failed.status !== "behavioral_failed") throw new Error(`Change is not behaviorally failed (status: ${failed.status})`);
  await db
    .update(changes)
    .set({ resolution: "keep_rule_fix", updatedAt: new Date() })
    .where(eq(changes.id, failedChangeId));
  await emit(db, {
    projectId: failed.projectId,
    changeId: failedChangeId,
    type: "change.resolved",
    payload: { resolution: "keep_rule_fix" },
  });
  return proposeChange(db, {
    projectId: failed.projectId,
    intent: `${failed.intent} (Keep the rule → Fix it)`,
    edits,
    parentChangeId: failedChangeId,
    proposal,
  });
}

/**
 * Everything needed to resolve a behaviorally failed change (fix it, or change the rule): what is live, what was
 * proposed, and how the proposal failed (from its verification run).
 */
export async function loadBlockedChangeContext(db: Db, failedChangeId: string) {
  const failed = await getChange(db, failedChangeId);
  const live = await loadCurrentVersions(db, failed.projectId);
  const blocked = await candidateVersions(db, failed);
  const [run] = await db
    .select()
    .from(runs)
    .where(eq(runs.changeId, failedChangeId))
    .orderBy(desc(runs.startedAt))
    .limit(1);
  const scenarios = await loadScenarios(db, failed.projectId);
  return { failed, live, blocked, results: run?.results ?? [], scenarios };
}
