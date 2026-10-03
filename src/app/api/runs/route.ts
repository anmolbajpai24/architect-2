import { loadCurrentVersions, runScenarios } from "@/scenarios/runner";
import { agentRuntimeProblem } from "@/server/config";
import { getDb, getRunOptions, projectSelector, resolveProject, startJob } from "@/server/context";
import { busyResponse, errorResponse, notFoundResponse } from "@/server/responses";

/** A run on live models calls a provider once per agent per scenario; see docs/DEPLOYMENT.md on this ceiling. */
export const maxDuration = 300;

/** Runs every scenario against the live agents, in the background. */
export async function POST(req: Request) {
  const { db } = await getDb();
  let project;
  try {
    project = await resolveProject(db, projectSelector(req));
  } catch (err) {
    return notFoundResponse(err);
  }
  const problem = agentRuntimeProblem(project.runtime);
  if (problem) return errorResponse(problem, 503);
  const started = startJob(db, project.id, "Running scenarios", async () =>
    runScenarios(db, {
      projectId: project.id,
      versions: await loadCurrentVersions(db, project.id),
      trigger: "manual",
      ...getRunOptions(project.runtime),
    }),
  );
  return started ? Response.json({ ok: true }, { status: 202 }) : busyResponse();
}
