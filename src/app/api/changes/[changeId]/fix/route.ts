import { eq } from "drizzle-orm";
import { keepRuleAndFix, verifyChange } from "@/changes/change";
import { fixEditsForIntent } from "@/changes/proposer";
import { changes } from "@/db/schema";
import { busyJob, getDb, getModes, getProjectId, startJob } from "@/server/context";
import { busyResponse, errorResponse } from "@/server/responses";

/** "Keep the rule → Fix it": revises a behaviorally failed change, then verifies the revision. */
export async function POST(_req: Request, ctx: { params: Promise<{ changeId: string }> }) {
  const { changeId } = await ctx.params;
  const { db } = await getDb();
  const [failed] = await db.select().from(changes).where(eq(changes.id, changeId));
  if (!failed) return errorResponse("Change not found.", 404);
  if (failed.status !== "behavioral_failed" || failed.resolution) {
    return errorResponse("Only an unresolved, behaviorally failed change can be fixed.", 409);
  }
  const edits = fixEditsForIntent(failed.intent);
  if (!edits) return errorResponse("No fix is available for this change in this build.", 422);
  if (busyJob()) return busyResponse();

  const projectId = await getProjectId(db);
  const fix = await keepRuleAndFix(db, changeId, edits);
  startJob(db, projectId, "Verifying fix", () => verifyChange(db, fix.id, getModes()));
  return Response.json({ changeId: fix.id }, { status: 202 });
}
