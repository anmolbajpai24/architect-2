import { and, eq, lt, or } from "drizzle-orm";
import type { Db } from "@/db/client";
import { changeShipments } from "@/db/schema";
import { emit } from "@/events";
import type { GitHubStatus } from "@/github/config";
import { GitHubError, type GitHubProvider } from "@/github/provider";
import { branchFor, buildShipArtifact } from "./artifact";
import { checkShipGate } from "./gate";

export type Shipment = typeof changeShipments.$inferSelect;

export class ShipError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ShipError";
  }
}

/** A "shipping" claim older than this is treated as abandoned (e.g. the server died mid-ship) and may be retried. */
const STALE_CLAIM_MS = 2 * 60_000;

export type ShipInput = {
  changeId: string;
  /** "owner/name"; defaults to the first configured repository. */
  repository?: string;
  github: { status: GitHubStatus; provider: GitHubProvider | null };
  publicUrl: string | null;
};

export type ShipOutcome = { shipment: Shipment; alreadyShipped: boolean };

/**
 * Ships a verified, applied Change to GitHub: branch `architect/change-<id>` from the default branch, one commit
 * with the verified agent/scenario definitions, and a pull request. Every gate is enforced here, not in the UI.
 *
 * Idempotent: an already-shipped change returns its recorded PR without calling GitHub; a retry after a failure
 * reuses the branch, skips the commit if the files are already there, and reuses an existing PR.
 */
export async function shipChange(db: Db, input: ShipInput): Promise<ShipOutcome> {
  const [existing] = await db.select().from(changeShipments).where(eq(changeShipments.changeId, input.changeId));
  if (existing?.status === "shipped") return { shipment: existing, alreadyShipped: true };

  const gate = await checkShipGate(db, input.changeId);
  if (!gate.ok) throw new ShipError(gate.reason, gate.status);
  const { change } = gate;

  const { status, provider } = input.github;
  if (!status.configured || !provider)
    throw new ShipError(`GitHub isn't configured on the server: ${status.problems.join("; ") || "no provider"}.`, 503);
  const repository = input.repository ?? status.repositories[0];
  if (!status.repositories.includes(repository))
    throw new ShipError(`${repository} isn't one of the repositories configured in ARCHITECT_GITHUB_REPOS.`, 400);
  const branch = branchFor(change.id);

  // Claim the change. The unique change_id makes a double click (or two tabs) produce one shipment, not two PRs.
  const fresh = { status: "shipping" as const, repository, branch, baseBranch: null, commitSha: null, prNumber: null, prUrl: null, error: null };
  const [claimed] = existing
    ? await db
        .update(changeShipments)
        .set({ ...fresh, updatedAt: new Date() })
        .where(
          and(
            eq(changeShipments.id, existing.id),
            or(
              eq(changeShipments.status, "failed"),
              and(eq(changeShipments.status, "shipping"), lt(changeShipments.updatedAt, new Date(Date.now() - STALE_CLAIM_MS))),
            ),
          ),
        )
        .returning()
    : await db
        .insert(changeShipments)
        .values({ ...fresh, projectId: change.projectId, changeId: change.id, runId: gate.liveRun.id, updatedAt: new Date() })
        .onConflictDoNothing()
        .returning();
  if (!claimed) {
    const [current] = await db.select().from(changeShipments).where(eq(changeShipments.changeId, change.id));
    if (current?.status === "shipped") return { shipment: current, alreadyShipped: true };
    throw new ShipError("This change is already being shipped.", 409);
  }

  const ev = (type: string, payload: Record<string, unknown>) => emit(db, { projectId: change.projectId, changeId: change.id, type, payload });
  const save = (fields: Partial<Shipment>) =>
    db
      .update(changeShipments)
      .set({ ...fields, updatedAt: new Date() })
      .where(eq(changeShipments.id, claimed.id))
      .returning()
      .then((rows) => rows[0]);

  await ev("change.shipping", { repository, branch });
  let step = "read the repository";
  try {
    const repo = await provider.getRepository(repository);
    const base = repo.defaultBranch;
    const baseHead = await provider.getBranch(repository, base);
    if (!baseHead) throw new ShipError(`The default branch ${base} of ${repository} has no commits.`, 409);
    await save({ baseBranch: base, runId: gate.liveRun.id });

    step = "create the branch";
    const existingBranch = await provider.getBranch(repository, branch);
    if (!existingBranch) await provider.createBranch(repository, branch, baseHead.sha);

    step = "commit the verified state";
    const artifact = await buildShipArtifact(db, gate, { publicUrl: input.publicUrl });
    const commit = await provider.commitFiles(repository, { branch, message: artifact.commitMessage, files: artifact.files });
    await save({ commitSha: commit.sha });

    step = "open the pull request";
    let pr = await provider.findPullRequest(repository, { head: branch, base });
    const reusedPr = Boolean(pr);
    if (!pr) {
      if (commit.sha === baseHead.sha)
        throw new ShipError(`${base} already contains exactly this verified state, so there is nothing to open a pull request for.`, 409);
      pr = await provider.createPullRequest(repository, { title: artifact.title, body: artifact.body, head: branch, base });
    }

    const shipment = await save({ status: "shipped", prNumber: pr.number, prUrl: pr.url, shippedAt: new Date() });
    await ev("change.shipped", {
      repository,
      branch,
      commitSha: commit.sha,
      prNumber: pr.number,
      prUrl: pr.url,
      reused: { branch: Boolean(existingBranch), commit: !commit.created, pullRequest: reusedPr },
    });
    return { shipment, alreadyShipped: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await save({ status: "failed", error: message });
    await ev("change.ship_failed", { repository, branch, step, message });
    if (err instanceof ShipError) throw err;
    throw new ShipError(message, err instanceof GitHubError ? 502 : 500);
  }
}
