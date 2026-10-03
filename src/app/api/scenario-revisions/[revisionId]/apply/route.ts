import { applyScenarioRevision, RevisionError, verifyRuleChange } from "@/scenarios/revisions";
import { liveModelProblem } from "@/server/config";
import { busyJob, getDb, getModes, startJob } from "@/server/context";
import { busyResponse, errorResponse } from "@/server/responses";

export const maxDuration = 60;

/**
 * "Change the rule", step 2: the user explicitly makes the revision the live rule. Then, in the background, every
 * scenario runs against the live agents and the blocked change is re-verified, both under the new rule.
 */
export async function POST(_req: Request, ctx: { params: Promise<{ revisionId: string }> }) {
  const { revisionId } = await ctx.params;
  const problem = liveModelProblem();
  if (problem) return errorResponse(problem, 503);
  if (busyJob()) return busyResponse();
  const { db } = await getDb();

  let applied: Awaited<ReturnType<typeof applyScenarioRevision>>;
  try {
    applied = await applyScenarioRevision(db, revisionId);
  } catch (err) {
    if (err instanceof RevisionError) return errorResponse(err.message, 409);
    throw err;
  }
  startJob(db, applied.projectId, "Verifying the new rule", () =>
    verifyRuleChange(db, { projectId: applied.projectId, revisionId, reverifyChangeId: applied.reverifyChangeId }, getModes()),
  );
  return Response.json({ ok: true, reverifyChangeId: applied.reverifyChangeId }, { status: 202 });
}
