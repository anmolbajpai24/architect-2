import { applyScenarioRevision, RevisionError, revisionProjectId, verifyRuleChange } from "@/scenarios/revisions";
import { agentRuntimeProblem } from "@/server/config";
import { openProjectById, ProjectForbidden } from "@/server/access";
import { busyJob, getDb, getRunOptions, startJob } from "@/server/context";
import { busyResponse, errorResponse, forbiddenResponse, notFoundResponse } from "@/server/responses";

export const maxDuration = 300;

/**
 * "Change the rule", step 2: the user explicitly makes the revision the live rule. Then, in the background, every
 * scenario runs against the live agents and the blocked change is re-verified, both under the new rule.
 */
export async function POST(_req: Request, ctx: { params: Promise<{ revisionId: string }> }) {
  const { revisionId } = await ctx.params;
  const { db } = await getDb();

  let project;
  try {
    project = await openProjectById(db, await revisionProjectId(db, revisionId));
  } catch (err) {
    if (err instanceof RevisionError) return errorResponse(err.message, 404);
    return err instanceof ProjectForbidden ? forbiddenResponse(err) : notFoundResponse(err);
  }

  const problem = agentRuntimeProblem(project.runtime);
  if (problem) return errorResponse(problem, 503);
  if (busyJob()) return busyResponse();

  let applied: Awaited<ReturnType<typeof applyScenarioRevision>>;
  try {
    applied = await applyScenarioRevision(db, revisionId, project.runtime.tools);
  } catch (err) {
    if (err instanceof RevisionError) return errorResponse(err.message, 409);
    throw err;
  }
  startJob(db, applied.projectId, "Verifying the new rule", () =>
    verifyRuleChange(
      db,
      { projectId: applied.projectId, revisionId, reverifyChangeId: applied.reverifyChangeId },
      getRunOptions(project.runtime),
    ),
  );
  return Response.json({ ok: true, reverifyChangeId: applied.reverifyChangeId }, { status: 202 });
}
