import { loadCurrentVersions, runScenarios } from "@/scenarios/runner";
import { liveModelProblem } from "@/server/config";
import { getDb, getModes, getProjectId, startJob } from "@/server/context";
import { busyResponse, errorResponse } from "@/server/responses";

/** A run on live models calls a provider once per agent per scenario; see docs/DEPLOYMENT.md on this ceiling. */
export const maxDuration = 60;

/** Runs every scenario against the live agents, in the background. */
export async function POST() {
  const problem = liveModelProblem();
  if (problem) return errorResponse(problem, 503);
  const { db } = await getDb();
  const projectId = await getProjectId(db);
  const started = startJob(db, projectId, "Running scenarios", async () =>
    runScenarios(db, {
      projectId,
      versions: await loadCurrentVersions(db, projectId),
      trigger: "manual",
      ...getModes(),
    }),
  );
  return started ? Response.json({ ok: true }, { status: 202 }) : busyResponse();
}
