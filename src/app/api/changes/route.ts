import { z } from "zod";
import { proposeChange, verifyChange } from "@/changes/change";
import { editsForIntent } from "@/changes/proposer";
import { busyJob, getDb, getModes, getProjectId, startJob } from "@/server/context";
import { busyResponse, errorResponse } from "@/server/responses";

const Body = z.object({ intent: z.string().trim().min(1) });

/** Records the request as a Change, then verifies it in the background (structural → behavioral). */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return errorResponse("Describe the change you want.", 400);
  const edits = editsForIntent(parsed.data.intent);
  if (!edits) {
    return errorResponse(
      "This build only turns the scripted demo request into a configuration change. Free-form requests need the LLM proposer, which comes in a later phase.",
      422,
    );
  }
  if (busyJob()) return busyResponse();

  const { db } = await getDb();
  const projectId = await getProjectId(db);
  const change = await proposeChange(db, { projectId, intent: parsed.data.intent, edits });
  startJob(db, projectId, "Verifying change", () => verifyChange(db, change.id, getModes()));
  return Response.json({ changeId: change.id }, { status: 202 });
}
