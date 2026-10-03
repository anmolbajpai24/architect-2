/**
 * pnpm scenarios:run [--reset] [--judge] [--live]
 * Runs every scenario against the project's current agent versions.
 */
import { openDb } from "@/db/client";
import { projectDefinition, projectRuntime } from "@/projects/registry";
import { loadCurrentVersions, runScenarios } from "@/scenarios/runner";
import { heading, parseFlags, printRun } from "./report";

const flags = parseFlags(process.argv.slice(2));
const { db, kind, close } = await openDb();
try {
  const definition = projectDefinition();
  const projectId = await definition.seed(db, { reset: flags.reset });
  const runtime = projectRuntime();
  heading(`Scenarios · ${definition.slug} · db: ${kind}`);
  const versions = await loadCurrentVersions(db, projectId);
  const run = await runScenarios(db, { projectId, versions, trigger: "manual", ...flags, runtime });
  printRun(run, flags.judge);
  process.exitCode = run.status === "passed" ? 0 : 1;
} finally {
  await close();
}
