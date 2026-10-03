import { eq } from "drizzle-orm";
import { z } from "zod";
import { loadBlockedChangeContext } from "@/changes/change";
import { ProposalError, proposerConfig } from "@/changes/proposer";
import { changes } from "@/db/schema";
import { emit } from "@/events";
import { draftScenarioRevision, type ScenarioDraft } from "@/scenarios/proposer";
import { canChangeRule, proposeScenarioRevision } from "@/scenarios/revisions";
import { claimBusy, getDb } from "@/server/context";
import { busyResponse, errorResponse } from "@/server/responses";

const Body = z.object({
  changeId: z.string().uuid(),
  scenarioKey: z.string().min(1),
  request: z.string().trim().min(1).max(2000),
});

/** Drafting the revised rule is one model call made inside the request. */
export const maxDuration = 60;

/**
 * "Change the rule", step 1: Architect drafts a revised Scenario from the user's new requirement and stores it as a
 * proposed version. Nothing is live until the user applies it.
 */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return errorResponse("Describe the new requirement.", 400);
  const { changeId, scenarioKey, request } = parsed.data;

  const { db } = await getDb();
  const [change] = await db.select().from(changes).where(eq(changes.id, changeId));
  if (!change) return errorResponse("Change not found.", 404);
  if (!canChangeRule(change)) return errorResponse("Only a blocked change can lead to a rule change.", 409);

  const release = claimBusy("Drafting rule change");
  if (!release) return busyResponse();

  const config = proposerConfig();
  let draft: ScenarioDraft;
  try {
    const context = await loadBlockedChangeContext(db, changeId);
    const scenario = context.scenarios.find((s) => s.key === scenarioKey);
    const failure = context.results.find((r) => r.scenarioKey === scenarioKey);
    if (!scenario) return errorResponse(`Unknown scenario "${scenarioKey}".`, 404);
    if (!failure || failure.status === "pass") {
      return errorResponse("That scenario didn't fail for this change, so there's no rule to change here.", 409);
    }
    await emit(db, {
      projectId: change.projectId,
      changeId,
      type: "scenario.revision_drafting",
      payload: { scenario: scenarioKey, request, mode: config.mode, model: config.model },
    });
    try {
      draft = await draftScenarioRevision({ scenario, request, versions: context.live, failure, config });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await emit(db, {
        projectId: change.projectId,
        changeId,
        type: "scenario.revision_draft_failed",
        payload: { scenario: scenarioKey, message },
      });
      return errorResponse(message, err instanceof ProposalError ? 422 : 500);
    }
  } finally {
    release();
  }

  const revision = await proposeScenarioRevision(db, {
    projectId: change.projectId,
    scenarioKey,
    content: draft.content,
    request,
    proposal: draft.proposal,
    changeId,
  });
  return Response.json({ revisionId: revision.id }, { status: 201 });
}
