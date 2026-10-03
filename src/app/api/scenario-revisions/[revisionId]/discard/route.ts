import { discardScenarioRevision, RevisionError, revisionProjectId } from "@/scenarios/revisions";
import { openProjectById, ProjectForbidden } from "@/server/access";
import { getDb } from "@/server/context";
import { errorResponse, forbiddenResponse, notFoundResponse } from "@/server/responses";

/** Drops a proposed revision. The live rule never changed, so there is nothing to undo. */
export async function POST(_req: Request, ctx: { params: Promise<{ revisionId: string }> }) {
  const { revisionId } = await ctx.params;
  const { db } = await getDb();

  try {
    await openProjectById(db, await revisionProjectId(db, revisionId), "change");
  } catch (err) {
    if (err instanceof RevisionError) return errorResponse(err.message, 404);
    return err instanceof ProjectForbidden ? forbiddenResponse(err) : notFoundResponse(err);
  }

  try {
    await discardScenarioRevision(db, revisionId);
  } catch (err) {
    if (err instanceof RevisionError) return errorResponse(err.message, 409);
    throw err;
  }
  return Response.json({ ok: true });
}
