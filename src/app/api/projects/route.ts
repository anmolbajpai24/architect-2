import { z } from "zod";
import { ProjectBlueprint, normalizeBlueprint } from "@/projects/blueprint";
import { materializeProject, MaterializeError } from "@/projects/materialize";
import { DEFAULT_AGENT_MODEL } from "@/runtime/models";
import { authEnabled, currentUser } from "@/server/auth";
import { getDb } from "@/server/context";
import { errorResponse } from "@/server/responses";

const Body = z.object({
  brief: z.string().trim().min(10).max(4000),
  blueprint: ProjectBlueprint,
});

/** Creating a project is a single transaction; no model is called here. */
export const maxDuration = 60;

/**
 * Creates a project from a reviewed blueprint.
 *
 * The blueprint comes back from the browser rather than from a server-side draft table, so it is re-parsed,
 * re-normalized and structurally verified here — the client can only describe a project, never smuggle one in.
 * The slug is derived on the server for the same reason.
 */
export async function POST(req: Request) {
  // A project belongs to whoever created it, so creating one needs a viewer whenever this server has sign-in.
  // Checked before the body, so an unauthenticated caller is told why rather than why their JSON is wrong.
  const viewer = await currentUser();
  if (authEnabled() && !viewer) return errorResponse("Sign in with Google to create a project.", 401);

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return errorResponse("That project plan can't be built. Describe your brief again.", 400);

  const { db } = await getDb();
  const { blueprint, notes } = normalizeBlueprint(parsed.data.blueprint);
  try {
    const created = await materializeProject(db, {
      blueprint,
      brief: parsed.data.brief,
      model: DEFAULT_AGENT_MODEL,
      notes,
      ownerId: viewer?.id ?? null,
    });
    return Response.json(created, { status: 201 });
  } catch (err) {
    if (err instanceof MaterializeError) return errorResponse(err.message, 422);
    throw err;
  }
}
