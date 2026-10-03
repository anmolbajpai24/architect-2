import { z } from "zod";
import { runPreview } from "@/preview/session";
import { agentRuntimeProblem } from "@/server/config";
import { openProject, ProjectForbidden } from "@/server/access";
import { getDb, getModes, projectSelector } from "@/server/context";
import { errorResponse, forbiddenResponse, notFoundResponse } from "@/server/responses";

const Body = z.object({ message: z.string().trim().min(1).max(4000) });

/** One turn runs every agent in the system, so this is as long as a single scenario on live models. */
export const maxDuration = 300;

/**
 * One preview turn: the project's live agents answer a message.
 *
 * It does not take the one-job lock. A turn only reads the live versions and writes nothing, so it can't
 * interleave destructively with a verification run — and a preview that refused to answer while scenarios were
 * running would be a worse lie than a slow one.
 */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return errorResponse("Type a message for the agents to answer.", 400);

  const { db } = await getDb();
  let project;
  try {
    project = await openProject(db, projectSelector(req));
  } catch (err) {
    return err instanceof ProjectForbidden ? forbiddenResponse(err) : notFoundResponse(err);
  }

  const problem = agentRuntimeProblem(project.runtime);
  if (problem) return errorResponse(problem, 503);

  const { mode } = getModes();
  const turn = await runPreview(db, project, parsed.data.message, mode);
  if (turn.agents.length === 0) {
    return errorResponse("This project has no live agents to run yet.", 409);
  }
  return Response.json({ ...turn, mode });
}
