import { and, eq, max } from "drizzle-orm";
import { loadBlockedChangeContext, verifyChange, type VerifyOptions } from "@/changes/change";
import type { Db } from "@/db/client";
import { changes, scenarios, scenarioVersions, type ScenarioProposal } from "@/db/schema";
import type { VersionSet } from "@/domain/schemas";
import type { ToolRegistry } from "@/runtime/tool-registry";
import { emit } from "@/events";
import { checkStructure } from "@/verify/structural";
import type { ScenarioContent } from "./proposer";
import { loadCurrentVersions, loadScenarios, runScenarios } from "./runner";

/**
 * "Change the rule": scenario revisions. A revision is an immutable ScenarioVersion that starts out proposed.
 * The live rule (scenarios.currentVersionId) moves only when the user explicitly applies it; agents are never
 * touched. Provenance: the revision records the user's request, the blocked Change that prompted it, the version
 * it revises, and who drafted it.
 */

/** A rule change that can't be applied as asked; the message is meant for the user. */
export class RevisionError extends Error {}

async function getRevision(db: Db, revisionId: string) {
  const [revision] = await db.select().from(scenarioVersions).where(eq(scenarioVersions.id, revisionId));
  if (!revision) throw new RevisionError("Scenario revision not found.");
  const [scenario] = await db.select().from(scenarios).where(eq(scenarios.id, revision.scenarioId));
  return { revision, scenario };
}

/** Whether a change can still be resolved by changing the rule (it hasn't been fixed instead). */
export function canChangeRule(change: { status: string; resolution: string | null }) {
  return change.status === "behavioral_failed" && change.resolution !== "keep_rule_fix";
}

/** Stores a drafted revision as a proposed version. The live scenario is untouched. */
export async function proposeScenarioRevision(
  db: Db,
  input: {
    projectId: string;
    scenarioKey: string;
    content: ScenarioContent;
    request: string;
    proposal: ScenarioProposal;
    changeId?: string;
  },
) {
  const [scenario] = await db
    .select()
    .from(scenarios)
    .where(and(eq(scenarios.projectId, input.projectId), eq(scenarios.key, input.scenarioKey)));
  if (!scenario) throw new RevisionError(`Unknown scenario "${input.scenarioKey}".`);

  return db.transaction(async (tx) => {
    const [{ latest }] = await tx
      .select({ latest: max(scenarioVersions.version) })
      .from(scenarioVersions)
      .where(eq(scenarioVersions.scenarioId, scenario.id));
    const [revision] = await tx
      .insert(scenarioVersions)
      .values({
        scenarioId: scenario.id,
        version: (latest ?? 0) + 1,
        ...input.content,
        basedOnVersionId: scenario.currentVersionId,
        changeId: input.changeId ?? null,
        request: input.request,
        proposal: input.proposal,
      })
      .returning();
    await emit(tx, {
      projectId: input.projectId,
      changeId: input.changeId,
      type: "scenario.revision_proposed",
      payload: { scenario: input.scenarioKey, revisionId: revision.id, version: revision.version, request: input.request },
    });
    return revision;
  });
}

/**
 * Makes a proposed revision the live rule. Refuses if the rule changed since the draft, or if the new rule
 * doesn't fit the agents it will judge (the live ones, and the blocked change's if it came from one).
 * Returns the blocked change to re-verify, if any.
 */
export async function applyScenarioRevision(db: Db, revisionId: string, tools: ToolRegistry) {
  const { revision, scenario } = await getRevision(db, revisionId);
  if (revision.appliedAt) throw new RevisionError("This revision has already been applied.");
  if (revision.discardedAt) throw new RevisionError("This revision was discarded.");
  if (scenario.currentVersionId !== revision.basedOnVersionId) {
    throw new RevisionError("The rule changed after this revision was drafted. Draft the rule change again.");
  }

  const [change] = revision.changeId ? await db.select().from(changes).where(eq(changes.id, revision.changeId)) : [];
  const reverify = change && canChangeRule(change) ? change : undefined;

  const rules = (await loadScenarios(db, scenario.projectId)).map((s) =>
    s.id === scenario.id ? { key: s.key, assertions: revision.assertions } : s,
  );
  const systems: [string, VersionSet][] = [["the live agents", await loadCurrentVersions(db, scenario.projectId)]];
  if (reverify) systems.push(["the blocked change", (await loadBlockedChangeContext(db, reverify.id)).blocked]);
  for (const [label, versions] of systems) {
    const problems = checkStructure(versions, rules, tools).filter((c) => !c.ok);
    if (problems.length) {
      throw new RevisionError(`The new rule doesn't fit ${label}: ${problems.map((c) => c.message).join("; ")}`);
    }
  }

  const [previous] = scenario.currentVersionId
    ? await db.select().from(scenarioVersions).where(eq(scenarioVersions.id, scenario.currentVersionId))
    : [];

  await db.transaction(async (tx) => {
    await tx.update(scenarios).set({ currentVersionId: revision.id }).where(eq(scenarios.id, scenario.id));
    await tx.update(scenarioVersions).set({ appliedAt: new Date() }).where(eq(scenarioVersions.id, revision.id));
    await emit(tx, {
      projectId: scenario.projectId,
      changeId: revision.changeId ?? undefined,
      type: "scenario.revised",
      payload: {
        scenario: scenario.key,
        revisionId: revision.id,
        fromVersion: previous?.version ?? null,
        toVersion: revision.version,
        request: revision.request,
      },
    });
    if (reverify) {
      // The agents in the change stay exactly as proposed; only the rule they're judged by changed.
      await tx
        .update(changes)
        .set({ resolution: "change_rule", status: "proposed", updatedAt: new Date() })
        .where(eq(changes.id, reverify.id));
      await emit(tx, {
        projectId: scenario.projectId,
        changeId: reverify.id,
        type: "change.resolved",
        payload: { resolution: "change_rule", scenario: scenario.key, revisionId: revision.id },
      });
    }
  });

  return { projectId: scenario.projectId, scenarioKey: scenario.key, reverifyChangeId: reverify?.id ?? null };
}

export async function discardScenarioRevision(db: Db, revisionId: string) {
  const { revision, scenario } = await getRevision(db, revisionId);
  if (revision.appliedAt) throw new RevisionError("An applied revision can't be discarded.");
  if (revision.discardedAt) return;
  await db.update(scenarioVersions).set({ discardedAt: new Date() }).where(eq(scenarioVersions.id, revisionId));
  await emit(db, {
    projectId: scenario.projectId,
    changeId: revision.changeId ?? undefined,
    type: "scenario.revision_discarded",
    payload: { scenario: scenario.key, revisionId, version: revision.version },
  });
}

/**
 * Verification after a rule change, through the existing pipeline: every scenario against the live agents, then
 * the blocked change re-verified (structural, then behavioral). A failure under the new rule stays a failure.
 */
export async function verifyRuleChange(
  db: Db,
  input: { projectId: string; revisionId: string; reverifyChangeId: string | null },
  opts: VerifyOptions,
) {
  const liveRun = await runScenarios(db, {
    projectId: input.projectId,
    versions: await loadCurrentVersions(db, input.projectId),
    trigger: "manual",
    ...opts,
  });
  const verification = input.reverifyChangeId ? await verifyChange(db, input.reverifyChangeId, opts) : null;
  return { liveRun, verification };
}
