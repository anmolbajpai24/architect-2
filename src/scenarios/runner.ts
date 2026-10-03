import { and, eq, isNotNull } from "drizzle-orm";
import type { Db } from "@/db/client";
import { agents, agentVersions, runs, scenarios, scenarioVersions } from "@/db/schema";
import { Assertion, type ScenarioResult, type VersionSet } from "@/domain/schemas";
import { emit } from "@/events";
import type { ModelMode } from "@/runtime/models";
import { runSystem } from "@/runtime/run-system";
import { describeAssertion, evaluateAssertion, type JudgeMode } from "./assertions";

/** The project's live agent system: each agent's current version. */
export async function loadCurrentVersions(db: Db, projectId: string): Promise<VersionSet> {
  const rows = await db
    .select({ key: agents.key, versionId: agentVersions.id, config: agentVersions.config })
    .from(agents)
    .innerJoin(agentVersions, eq(agents.currentVersionId, agentVersions.id))
    .where(and(eq(agents.projectId, projectId), isNotNull(agents.currentVersionId)));
  return Object.fromEntries(rows.map((r) => [r.key, { versionId: r.versionId, config: r.config }]));
}

/** The project's live rules: each scenario's current version. */
export async function loadScenarios(db: Db, projectId: string) {
  const rows = await db
    .select({
      id: scenarios.id,
      key: scenarios.key,
      createdAt: scenarios.createdAt,
      versionId: scenarioVersions.id,
      version: scenarioVersions.version,
      name: scenarioVersions.name,
      intent: scenarioVersions.intent,
      input: scenarioVersions.input,
      assertions: scenarioVersions.assertions,
    })
    .from(scenarios)
    .innerJoin(scenarioVersions, eq(scenarios.currentVersionId, scenarioVersions.id))
    .where(eq(scenarios.projectId, projectId))
    .orderBy(scenarios.createdAt);
  return rows.map((s) => ({ ...s, assertions: Assertion.array().parse(s.assertions) }));
}

export type LoadedScenario = Awaited<ReturnType<typeof loadScenarios>>[number];

export type RunOptions = {
  projectId: string;
  versions: VersionSet;
  trigger: "manual" | "change";
  changeId?: string;
  mode: ModelMode;
  judge: JudgeMode;
};

export async function runScenarios(db: Db, opts: RunOptions) {
  const versionIds = Object.fromEntries(Object.entries(opts.versions).map(([k, v]) => [k, v.versionId]));
  const [run] = await db
    .insert(runs)
    .values({
      projectId: opts.projectId,
      changeId: opts.changeId ?? null,
      trigger: opts.trigger,
      modelMode: opts.mode,
      versionIds,
    })
    .returning();
  const ev = (type: string, payload: Record<string, unknown> = {}) =>
    emit(db, { projectId: opts.projectId, runId: run.id, changeId: opts.changeId, type, payload });

  await ev("run.started", { trigger: opts.trigger, mode: opts.mode, judge: opts.judge, versionIds });

  const results: ScenarioResult[] = [];
  for (const scenario of await loadScenarios(db, opts.projectId)) {
    await ev("scenario.started", { scenario: scenario.key });
    const trace = await runSystem(db, opts.versions, scenario.input.message, opts.mode);
    for (const call of trace.toolCalls) await ev("tool.called", { scenario: scenario.key, ...call });

    const assertions = [];
    for (const a of scenario.assertions) {
      const r = await evaluateAssertion(a, trace, scenario.input.message, opts.judge);
      assertions.push(r);
      await ev("assertion.evaluated", {
        scenario: scenario.key,
        assertion: describeAssertion(a),
        status: r.status,
        actual: r.actual ?? null,
        reason: r.reason ?? null,
      });
    }

    const status: ScenarioResult["status"] =
      trace.error || assertions.some((r) => r.status === "error")
        ? "error"
        : assertions.some((r) => r.status === "fail")
          ? "fail"
          : "pass";
    results.push({
      scenarioId: scenario.id,
      scenarioKey: scenario.key,
      scenarioVersionId: scenario.versionId,
      scenarioVersion: scenario.version,
      name: scenario.name,
      status,
      assertions,
      trace,
    });
    await ev("scenario.finished", { scenario: scenario.key, status, error: trace.error ?? null });
  }

  const status = results.every((r) => r.status === "pass") ? "passed" : "failed";
  const [finished] = await db
    .update(runs)
    .set({ status, results, finishedAt: new Date() })
    .where(eq(runs.id, run.id))
    .returning();
  await ev("run.finished", { status, passed: results.filter((r) => r.status === "pass").length, total: results.length });
  return { ...finished, results };
}
