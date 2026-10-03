import { z } from "zod";
import { proposeChange, verifyChange } from "@/changes/change";
import { draftChange, ProposalError, proposerConfig, type Draft } from "@/changes/proposer";
import { emit } from "@/events";
import { loadCurrentVersions } from "@/scenarios/runner";
import { agentRuntimeProblem } from "@/server/config";
import { openProject, ProjectForbidden } from "@/server/access";
import { claimBusy, getDb, getRunOptions, projectSelector, startJob } from "@/server/context";
import { busyResponse, errorResponse, forbiddenResponse, notFoundResponse } from "@/server/responses";

const Body = z.object({ intent: z.string().trim().min(1).max(2000) });

/** Drafting is one model call in the request; verifying the draft then runs every scenario in the background. */
export const maxDuration = 300;

/**
 * Architect drafts edits for the request (LLM proposer), records them as a Change, then verifies it in the
 * background (structural → behavioral). Drafting happens in the request so failures come straight back.
 */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return errorResponse("Describe the change you want.", 400);
  const { intent } = parsed.data;

  const { db } = await getDb();
  let project;
  try {
    project = await openProject(db, projectSelector(req), "change");
  } catch (err) {
    return err instanceof ProjectForbidden ? forbiddenResponse(err) : notFoundResponse(err);
  }

  const problem = agentRuntimeProblem(project.runtime);
  if (problem) return errorResponse(problem, 503);

  const release = claimBusy("Drafting change");
  if (!release) return busyResponse();

  const projectId = project.id;
  const config = proposerConfig();
  let draft: Draft;
  try {
    await emit(db, { projectId, type: "change.drafting", payload: { intent, mode: config.mode, model: config.model } });
    draft = await draftChange({
      intent,
      versions: await loadCurrentVersions(db, projectId),
      runtime: project.runtime,
      config,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await emit(db, { projectId, type: "change.draft_failed", payload: { intent, message } });
    return errorResponse(message, err instanceof ProposalError ? 422 : 500);
  } finally {
    release();
  }

  const change = await proposeChange(db, { projectId, intent, edits: draft.edits, proposal: draft.proposal });
  startJob(db, projectId, "Verifying change", () => verifyChange(db, change.id, getRunOptions(project.runtime)));
  return Response.json({ changeId: change.id }, { status: 202 });
}
