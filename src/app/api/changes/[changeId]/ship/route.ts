import { z } from "zod";
import { githubProviderFromEnv, githubStatus, publicUrl } from "@/github/config";
import { shipChange, ShipError } from "@/shipping/ship";
import { claimBusy, getDb } from "@/server/context";
import { busyResponse, errorResponse } from "@/server/responses";

const Body = z.object({ repository: z.string().trim().min(1).optional() });

/** Shipping is a short sequence of GitHub REST calls made inside the request. */
export const maxDuration = 60;

/**
 * Ships a verified, applied change to GitHub (branch → commit → pull request), server-side with the server's
 * credential. The gate is enforced in shipChange; the UI hiding the button is only a convenience.
 * 201: shipped now. 200: already shipped (the recorded PR is returned, GitHub isn't called again).
 */
export async function POST(req: Request, ctx: { params: Promise<{ changeId: string }> }) {
  const { changeId } = await ctx.params;
  if (!z.uuid().safeParse(changeId).success) return errorResponse("Change not found.", 404);
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return errorResponse("Invalid ship request.", 400);

  const release = claimBusy("Shipping to GitHub");
  if (!release) return busyResponse();
  try {
    const { db } = await getDb();
    const { shipment, alreadyShipped } = await shipChange(db, {
      changeId,
      repository: parsed.data.repository,
      github: { status: githubStatus(), provider: githubProviderFromEnv() },
      publicUrl: publicUrl(),
    });
    return Response.json(
      {
        alreadyShipped,
        shipment: {
          repository: shipment.repository,
          branch: shipment.branch,
          commitSha: shipment.commitSha,
          prNumber: shipment.prNumber,
          prUrl: shipment.prUrl,
          shippedAt: shipment.shippedAt?.toISOString() ?? null,
        },
      },
      { status: alreadyShipped ? 200 : 201 },
    );
  } catch (err) {
    if (err instanceof ShipError) return errorResponse(err.message, err.status);
    throw err;
  } finally {
    release();
  }
}
