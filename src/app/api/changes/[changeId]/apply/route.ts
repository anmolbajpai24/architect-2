import { eq } from "drizzle-orm";
import { applyChange } from "@/changes/change";
import { changes } from "@/db/schema";
import { loadCurrentVersions, runScenarios } from "@/scenarios/runner";
import { agentRuntimeProblem } from "@/server/config";
import { busyJob, getDb, getRunOptions, projectById, startJob } from "@/server/context";
import { busyResponse, errorResponse, notFoundResponse } from "@/server/responses";

export const maxDuration = 300;

/** Applies a verified change, then re-runs every scenario against the now-live agents. */
export async function POST(_req: Request, ctx: { params: Promise<{ changeId: string }> }) {
  const { changeId } = await ctx.params;
  const { db } = await getDb();
  const [change] = await db.select().from(changes).where(eq(changes.id, changeId));
  if (!change) return errorResponse("Change not found.", 404);
  if (change.status !== "verified") return errorResponse("Only verified changes can be applied.", 409);

  let project;
  try {
    project = await projectById(db, change.projectId);
  } catch (err) {
    return notFoundResponse(err);
  }
  const problem = agentRuntimeProblem(project.runtime);
  if (problem) return errorResponse(problem, 503);
  if (busyJob()) return busyResponse();

  const projectId = project.id;
  await applyChange(db, changeId);
  startJob(db, projectId, "Running scenarios on live agents", async () =>
    runScenarios(db, {
      projectId,
      versions: await loadCurrentVersions(db, projectId),
      trigger: "manual",
      ...getRunOptions(project.runtime),
    }),
  );
  return Response.json({ ok: true }, { status: 202 });
}
