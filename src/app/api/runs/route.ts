import { loadCurrentVersions, runScenarios } from "@/scenarios/runner";
import { agentRuntimeProblem } from "@/server/config";
import { openProject, ProjectForbidden } from "@/server/access";
import { getDb, getRunOptions, projectSelector, startJob } from "@/server/context";
import { busyResponse, errorResponse, forbiddenResponse, notFoundResponse } from "@/server/responses";

/** A run on live models calls a provider once per agent per scenario; see docs/DEPLOYMENT.md on this ceiling. */
export const maxDuration = 300;

/** Runs every scenario against the live agents, in the background. */
export async function POST(req: Request) {
  const { db } = await getDb();
  let project;
  try {
    project = await openProject(db, projectSelector(req));
  } catch (err) {
    return err instanceof ProjectForbidden ? forbiddenResponse(err) : notFoundResponse(err);
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
