import { discardScenarioRevision, RevisionError } from "@/scenarios/revisions";
import { getDb } from "@/server/context";
import { errorResponse } from "@/server/responses";

/** Drops a proposed revision. The live rule never changed, so there is nothing to undo. */
export async function POST(_req: Request, ctx: { params: Promise<{ revisionId: string }> }) {
  const { revisionId } = await ctx.params;
  const { db } = await getDb();
  try {
    await discardScenarioRevision(db, revisionId);
  } catch (err) {
    if (err instanceof RevisionError) return errorResponse(err.message, 409);
    throw err;
  }
  return Response.json({ ok: true });
}
