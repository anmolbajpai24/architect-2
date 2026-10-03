import { and, eq, inArray, isNotNull } from "drizzle-orm";
import type { Db } from "@/db/client";
import { agents, agentVersions, changes, runs, scenarioVersions } from "@/db/schema";
import { lineDiff } from "@/domain/format";
import type { AgentConfig, ScenarioResult } from "@/domain/schemas";
import type { FileChange } from "@/github/provider";
import type { ShipReady } from "./gate";

/**
 * What a shipped Change puts in the repository. Architect doesn't generate application code yet, so the honest
 * artifact is the verified agent system itself: machine-readable agent and scenario definitions plus a record of
 * the change and its verification. Agent and scenario files carry no timestamps, so shipping identical state twice
 * produces an identical tree (no empty commits).
 */
export const ARTIFACT_ROOT = "architect";

export const changeLabel = (changeId: string) => `#${changeId.slice(0, 6)}`;
export const branchFor = (changeId: string) => `architect/change-${changeId}`;

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

/** Field order fixed for readable diffs; instructions one line per item (join with "\n" to restore). */
function agentDefinition(key: string, version: number, versionId: string, c: AgentConfig) {
  return {
    key,
    version,
    versionId,
    name: c.name,
    role: c.role,
    model: c.model,
    instructions: c.instructions.split("\n"),
    tools: c.tools,
    handoffs: c.handoffs,
    outputSchema: c.outputSchema,
  };
}

function summarizeRun(run: typeof runs.$inferSelect) {
  const results: ScenarioResult[] = run.results ?? [];
  return {
    runId: run.id,
    finishedAt: run.finishedAt?.toISOString() ?? null,
    modelMode: run.modelMode,
    passed: results.filter((r) => r.status === "pass").length,
    total: results.length,
    scenarios: results.map((r) => ({
      key: r.scenarioKey,
      version: r.scenarioVersion ?? null,
      status: r.status,
      checks: {
        passed: r.assertions.filter((a) => a.status === "pass").length,
        failed: r.assertions.filter((a) => a.status === "fail" || a.status === "error").length,
        skipped: r.assertions.filter((a) => a.status === "skipped").length,
      },
    })),
  };
}

const README = `# Architect state

Machine-readable definition of the agent system **as verified by Architect 2.0**. Each Architect pull request
updates these files only after the change passed structural and behavioral verification.

- \`agents/<key>.json\`: the live AgentVersion of each agent (\`instructions\` is one array item per line).
- \`scenarios/<key>.json\`: the rules (scenarios) the agents were verified against.
- \`changes/<change-id>.json\`: the Architect change, the user's request and its verification results.

This is Architect's current prototype representation of a verified change. It is not generated application code.
`;

export type ShipArtifact = { files: FileChange[]; title: string; body: string; commitMessage: string };

export async function buildShipArtifact(db: Db, ready: ShipReady, opts: { publicUrl: string | null }): Promise<ShipArtifact> {
  const { change, verificationRun, liveRun, scenarios } = ready;
  const label = changeLabel(change.id);

  // The verified version set (== the live agents, per the gate), plus the base versions of the agents it changed.
  const versionIds = [...Object.values(verificationRun.versionIds), ...Object.values(change.baseVersionIds)];
  const versionRows = await db
    .select({ id: agentVersions.id, version: agentVersions.version, config: agentVersions.config, key: agents.key, name: agents.name })
    .from(agentVersions)
    .innerJoin(agents, eq(agentVersions.agentId, agents.id))
    .where(inArray(agentVersions.id, versionIds));
  const byId = new Map(versionRows.map((v) => [v.id, v]));

  const changed = Object.keys(change.proposedVersionIds).map((key) => {
    const from = byId.get(change.baseVersionIds[key])!;
    const to = byId.get(change.proposedVersionIds[key])!;
    return { key, name: to.name, from, to, diff: lineDiff(from.config.instructions, to.config.instructions) };
  });

  const parent = change.parentChangeId ? (await db.select().from(changes).where(eq(changes.id, change.parentChangeId)))[0] : undefined;
  const ruleChanges = await db
    .select()
    .from(scenarioVersions)
    .where(and(eq(scenarioVersions.changeId, change.id), isNotNull(scenarioVersions.appliedAt)));

  const record = {
    change: label,
    id: change.id,
    request: change.intent,
    createdAt: change.createdAt.toISOString(),
    revises: parent ? { change: changeLabel(parent.id), id: parent.id, resolution: parent.resolution } : null,
    proposal: change.proposal,
    agentsChanged: changed.map((c) => ({ agent: c.key, from: c.from.version, to: c.to.version })),
    ruleChanges: ruleChanges.map((v) => ({
      scenario: scenarios.find((s) => s.id === v.scenarioId)?.key ?? v.scenarioId,
      version: v.version,
      request: v.request,
    })),
    verification: {
      structural: { passed: true, checks: change.structural },
      behavioral: summarizeRun(verificationRun),
      liveAgents: summarizeRun(liveRun),
    },
    representation: "prototype: verified agent and scenario definitions, not generated application code",
  };

  const files: FileChange[] = [
    { path: `${ARTIFACT_ROOT}/README.md`, content: README },
    ...Object.entries(verificationRun.versionIds)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, id]) => {
        const v = byId.get(id)!;
        return { path: `${ARTIFACT_ROOT}/agents/${key}.json`, content: json(agentDefinition(key, v.version, v.id, v.config)) };
      }),
    ...scenarios.map((s) => ({
      path: `${ARTIFACT_ROOT}/scenarios/${s.key}.json`,
      content: json({ key: s.key, version: s.version, versionId: s.versionId, name: s.name, intent: s.intent, input: s.input, assertions: s.assertions }),
    })),
    { path: `${ARTIFACT_ROOT}/changes/${change.id}.json`, content: json(record) },
  ];

  const request = change.intent.length > 72 ? `${change.intent.slice(0, 71).trimEnd()}…` : change.intent;
  const title = `Architect Change ${label}: ${request}`;
  const behavioral = record.verification.behavioral;
  const liveAgents = record.verification.liveAgents;
  const skipped = (verificationRun.results ?? []).reduce((n, r) => n + r.assertions.filter((a) => a.status === "skipped").length, 0);
  const at = (iso: string | null) => (iso ? iso.replace("T", " ").replace(/\.\d+Z$/, " UTC") : "unknown");

  const body = [
    "## Verified by Architect 2.0",
    "",
    "| | |",
    "|---|---|",
    `| Change | ${label}${opts.publicUrl ? ` ([open in Architect](${opts.publicUrl}/?change=${change.id}))` : ""} |`,
    `| Request | ${change.intent.replace(/\|/g, "\\|")} |`,
    `| Agents changed | ${changed.map((c) => `${c.name} v${c.from.version} → v${c.to.version}`).join(", ") || "none"} |`,
    `| Structural verification | Passed (${change.structural?.length ?? 0} checks) |`,
    `| Behavioral verification | ${behavioral.passed}/${behavioral.total} scenarios passing |`,
    `| Verified | ${at(behavioral.finishedAt)} (run \`${behavioral.runId.slice(0, 8)}\`) |`,
    `| Re-verified on live agents | ${liveAgents.passed}/${liveAgents.total} passing, ${at(liveAgents.finishedAt)} (run \`${liveAgents.runId.slice(0, 8)}\`) |`,
    "",
    "This PR was created only after the Architect change passed verification.",
    "",
    "### Scenarios",
    ...behavioral.scenarios.map((s) => {
      const name = scenarios.find((x) => x.key === s.key)?.name ?? s.key;
      const skippedNote = s.checks.skipped ? `, ${s.checks.skipped} skipped` : "";
      return `- ${s.status === "pass" ? "✅" : "❌"} ${name} (rule v${s.version ?? "?"}): ${s.checks.passed} checks passed${skippedNote}`;
    }),
    ...(behavioral.modelMode === "fixture" || skipped
      ? [
          "",
          `_Agents ran on ${behavioral.modelMode === "fixture" ? "Architect's deterministic fixture model" : "their configured models"}${
            skipped ? `; ${skipped} LLM-judge check(s) were skipped and did not count as passes` : ""
          }._`,
        ]
      : []),
    ...(parent || ruleChanges.length
      ? [
          "",
          "### How it got here",
          ...(parent ? [`- Revises blocked change ${changeLabel(parent.id)} (“${parent.intent}”): Keep the rule → Fix it.`] : []),
          ...ruleChanges.map((v) => {
            const s = scenarios.find((x) => x.id === v.scenarioId);
            return `- Rule changed by the user: ${s?.name ?? "scenario"} → v${v.version}${v.request ? ` (“${v.request}”)` : ""}.`;
          }),
        ]
      : []),
    ...changed.flatMap((c) =>
      c.diff.removed.length || c.diff.added.length
        ? ["", `### ${c.name} instructions (v${c.from.version} → v${c.to.version})`, "```diff", ...c.diff.removed.map((l) => `- ${l}`), ...c.diff.added.map((l) => `+ ${l}`), "```"]
        : [],
    ),
    "",
    "### What this PR contains",
    "Prototype representation: Architect does not generate application code yet. This PR commits the verified agent system as machine-readable definitions:",
    `- \`${ARTIFACT_ROOT}/agents/*.json\`: the AgentVersions that were verified (and are live in Architect)`,
    `- \`${ARTIFACT_ROOT}/scenarios/*.json\`: the scenarios they were verified against`,
    `- \`${ARTIFACT_ROOT}/changes/${change.id}.json\`: this change and its verification record`,
    "",
  ].join("\n");

  const commitMessage = [
    title,
    "",
    `Verified by Architect 2.0: structural verification passed, ${behavioral.passed}/${behavioral.total} scenarios passing.`,
    "",
    `Architect-Change: ${change.id}`,
  ].join("\n");

  return { files, title, body, commitMessage };
}
