import { z } from "zod";
import { planProject, PlanError } from "@/projects/planner";
import { authEnabled, currentUser } from "@/server/auth";
import { errorResponse } from "@/server/responses";

const Body = z.object({ brief: z.string().trim().min(10).max(4000) });

/**
 * Planning is one model call that generates an entire project description, so it is the longest request this
 * server makes: ~5,500 output tokens, around a minute on claude-opus-5-5. 300s is Vercel's default maximum
 * duration and the ceiling on every plan (Hobby included) with fluid compute, so this is a limit, not a budget.
 */
export const maxDuration = 300;

/**
 * Turns a brief into a blueprint, and writes nothing.
 *
 * The result is a proposal the user reviews and then builds: splitting planning from creation is what makes the
 * review step honest, because what comes back here is exactly what POST /api/projects will materialize.
 */
export async function POST(req: Request) {
  // Planning spends a model call, so it needs the same viewer that creating the project will require.
  if (authEnabled() && !(await currentUser())) return errorResponse("Sign in with Google to plan a project.", 401);

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return errorResponse("Describe what you want to build, in a sentence or two.", 400);
  try {
    const plan = await planProject(parsed.data.brief);
    return Response.json({
      blueprint: plan.blueprint,
      notes: plan.notes,
      model: plan.model,
      brief: parsed.data.brief,
    });
  } catch (err) {
    if (err instanceof PlanError) return errorResponse(err.message, 422);
    throw err;
  }
}
