/**
 * pnpm scenarios:run [--reset] [--judge] [--live]
 * Runs every scenario against the project's current agent versions.
 */
import { openDb } from "@/db/client";
import { loadCurrentVersions, runScenarios } from "@/scenarios/runner";
import { seedDemo } from "@/seed";
import { heading, parseFlags, printRun } from "./report";

const flags = parseFlags(process.argv.slice(2));
const { db, kind, close } = await openDb();
try {
  const projectId = await seedDemo(db, { reset: flags.reset });
  heading(`Scenarios · laptop-advisor · db: ${kind}`);
  const versions = await loadCurrentVersions(db, projectId);
  const run = await runScenarios(db, { projectId, versions, trigger: "manual", ...flags });
  printRun(run, flags.judge);
  process.exitCode = run.status === "passed" ? 0 : 1;
} finally {
  await close();
}
