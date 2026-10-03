import { eq } from "drizzle-orm";
import { keepRuleAndFix, loadBlockedChangeContext, verifyChange } from "@/changes/change";
import { draftFix, ProposalError, proposerConfig, type Draft } from "@/changes/proposer";
import { changes } from "@/db/schema";
import { emit } from "@/events";
import { claimBusy, getDb, getModes, startJob } from "@/server/context";
import { busyResponse, errorResponse } from "@/server/responses";

/**
 * "Keep the rule → Fix it": Architect drafts a revision of a behaviorally failed change that keeps the
 * protected behavior, records it as a child Change, then verifies it in the background.
 */
export async function POST(_req: Request, ctx: { params: Promise<{ changeId: string }> }) {
  const { changeId } = await ctx.params;
  const { db } = await getDb();
  const [failed] = await db.select().from(changes).where(eq(changes.id, changeId));
  if (!failed) return errorResponse("Change not found.", 404);
  // Allowed after a rule change too: a change that still fails under the new rule can be fixed against it.
  if (failed.status !== "behavioral_failed" || failed.resolution === "keep_rule_fix") {
    return errorResponse("Only an unresolved, behaviorally failed change can be fixed.", 409);
  }

  const release = claimBusy("Drafting fix");
  if (!release) return busyResponse();

  const config = proposerConfig();
  let draft: Draft;
  try {
    await emit(db, {
      projectId: failed.projectId,
      changeId,
      type: "change.drafting",
      payload: { intent: failed.intent, fix: true, mode: config.mode, model: config.model },
    });
    const context = await loadBlockedChangeContext(db, changeId);
    draft = await draftFix({
      intent: failed.intent,
      live: context.live,
      blocked: context.blocked,
      editedAgents: Object.keys(failed.proposedVersionIds),
      scenarios: context.scenarios,
      results: context.results,
      config,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await emit(db, { projectId: failed.projectId, changeId, type: "change.draft_failed", payload: { intent: failed.intent, message } });
    return errorResponse(message, err instanceof ProposalError ? 422 : 500);
  } finally {
    release();
  }

  const fix = await keepRuleAndFix(db, changeId, draft.edits, draft.proposal);
  startJob(db, failed.projectId, "Verifying fix", () => verifyChange(db, fix.id, getModes()));
  return Response.json({ changeId: fix.id }, { status: 202 });
}
