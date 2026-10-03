/**
 * pnpm scenarios:regress [--judge] [--live]
 * Reproduces the key demo end to end and exits non-zero if any step doesn't go as expected:
 * baseline passes → persuasive change is structurally valid but fails a behavioral scenario →
 * explanation → "Keep the rule → Fix it" → fix passes and is applied → scenarios pass.
 */
import { and, count, eq } from "drizzle-orm";
import { applyChange, keepRuleAndFix, proposeChange, verifyChange } from "@/changes/change";
import { openDb, type Db } from "@/db/client";
import { agents, agentVersions, events } from "@/db/schema";
import { fixEdits } from "@/fixtures/fix";
import { REGRESSION_INTENT, regressionEdits } from "@/fixtures/regression";
import { loadCurrentVersions, runScenarios } from "@/scenarios/runner";
import { seedDemo } from "@/seed";
import { c, heading, parseFlags, printExplanation, printRun, printStructural } from "./report";

const flags = parseFlags(process.argv.slice(2));
const problems: string[] = [];
const expect = (ok: boolean, what: string) => {
  console.log(`${ok ? c.green("  ✔ expected:") : c.red("  ✘ NOT as expected:")} ${what}`);
  if (!ok) problems.push(what);
};

async function currentVersionNumber(db: Db, projectId: string, key: string) {
  const [row] = await db
    .select({ version: agentVersions.version })
    .from(agents)
    .innerJoin(agentVersions, eq(agents.currentVersionId, agentVersions.id))
    .where(and(eq(agents.projectId, projectId), eq(agents.key, key)));
  return row?.version;
}

const { db, kind, close } = await openDb();
try {
  const projectId = await seedDemo(db, { reset: true });
  const verifyOpts = { mode: flags.mode, judge: flags.judge };

  heading(`1. Initial agent · db: ${kind}`);
  const baseline = await runScenarios(db, {
    projectId,
    versions: await loadCurrentVersions(db, projectId),
    trigger: "manual",
    ...verifyOpts,
  });
  printRun(baseline, flags.judge);
  expect(baseline.status === "passed", "all scenarios pass on Recommendation Agent v1");

  heading(`2. User asks: "${REGRESSION_INTENT}"`);
  const change = await proposeChange(db, { projectId, intent: REGRESSION_INTENT, edits: regressionEdits });
  console.log(`Change ${change.id.slice(0, 8)} proposes a new Recommendation Agent version (not live yet).`);
  const verified = await verifyChange(db, change.id, verifyOpts);
  printStructural(verified.structural);
  expect(verified.structural.every((x) => x.ok), "structural verification passes");
  if (verified.run) printRun(verified.run, flags.judge);
  const failedKeys = verified.run?.results.filter((r) => r.status !== "pass").map((r) => r.scenarioKey) ?? [];
  expect(
    verified.change.status === "behavioral_failed" && failedKeys.join() === "no-match-honesty",
    `behavioral scenario "no-match-honesty" fails (failed: ${failedKeys.join(", ") || "none"})`,
  );
  if (verified.change.explanation) printExplanation(verified.change.explanation);
  expect(
    (await currentVersionNumber(db, projectId, "recommendation-agent")) === 1,
    "failed change is gated: Recommendation Agent stays on v1",
  );

  heading('3. User chooses "Keep the rule → Fix it"');
  const fix = await keepRuleAndFix(db, change.id, fixEdits);
  console.log(`Change ${fix.id.slice(0, 8)} revises ${change.id.slice(0, 8)}: confident tone, honesty rule restored.`);
  const fixVerified = await verifyChange(db, fix.id, verifyOpts);
  printStructural(fixVerified.structural);
  if (fixVerified.run) {
    printRun(fixVerified.run, flags.judge);
    const noMatch = fixVerified.run.results.find((r) => r.scenarioKey === "no-match-honesty");
    const reply = (noMatch?.trace.agents["store-advisor"]?.output as { reply?: string } | undefined)?.reply;
    if (reply) console.log(c.dim(`  no-match reply now: "${reply}"`));
  }
  expect(fixVerified.change.status === "verified", "fix passes structural and behavioral verification");
  if (fixVerified.change.status === "verified") await applyChange(db, fix.id);
  const liveVersion = await currentVersionNumber(db, projectId, "recommendation-agent");
  expect(liveVersion === 3, `fix is applied: Recommendation Agent is now v${liveVersion} (v2 was the rejected proposal)`);

  heading("4. Scenarios against the live agent");
  const after = await runScenarios(db, {
    projectId,
    versions: await loadCurrentVersions(db, projectId),
    trigger: "manual",
    ...verifyOpts,
  });
  printRun(after, flags.judge);
  expect(after.status === "passed", "all scenarios pass again");

  const [{ n }] = await db.select({ n: count() }).from(events).where(eq(events.projectId, projectId));
  heading("Result");
  console.log(c.dim(`${n} events recorded for project laptop-advisor.`));
  if (problems.length) {
    console.log(c.red(`Demo did NOT reproduce (${problems.length} unexpected step(s)).`));
    process.exitCode = 1;
  } else {
    console.log(c.green("Demo reproduced: pass → structural ok → behavioral fail → explain → keep rule & fix → pass."));
  }
} finally {
  await close();
}
