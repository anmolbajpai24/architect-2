import { openProject, ProjectForbidden } from "@/server/access";
import { bootstrapProject, busyJob, getDb, projectSelector } from "@/server/context";
import { hasDefinition } from "@/projects/registry";
import { busyResponse, errorResponse, forbiddenResponse, notFoundResponse } from "@/server/responses";

/**
 * Restores a project to its seeded state: v1 agents, no changes or runs.
 *
 * Only a project backed by a definition in code has a seeded state to restore. A project created from a brief
 * has no earlier version of itself to go back to, so this says so rather than deleting the user's work.
 */
export async function POST(req: Request) {
  if (busyJob()) return busyResponse();
  const { db } = await getDb();
  let project;
  try {
    project = await openProject(db, projectSelector(req), "change");
  } catch (err) {
    return err instanceof ProjectForbidden ? forbiddenResponse(err) : notFoundResponse(err);
  }
  if (!hasDefinition(project.slug)) {
    return errorResponse("This project was created from a brief, so there is no seeded state to reset it to.", 409);
  }
  await bootstrapProject(db, { reset: true, slug: project.slug });
  return Response.json({ ok: true });
}
