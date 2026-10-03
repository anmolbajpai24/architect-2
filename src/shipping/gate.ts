import { and, desc, eq, isNull } from "drizzle-orm";
import type { Db } from "@/db/client";
import { changes, events, runs } from "@/db/schema";
import { loadCurrentVersions, loadScenarios, type LoadedScenario } from "@/scenarios/runner";

type ChangeRow = typeof changes.$inferSelect;
type RunRow = typeof runs.$inferSelect;

export type ShipReady = {
  ok: true;
  change: ChangeRow;
  /** The run that verified the change before it was applied. */
  verificationRun: RunRow;
  /** The latest run against the live agents (after apply), under the current rules. */
  liveRun: RunRow;
  scenarios: LoadedScenario[];
};
export type ShipBlocked = { ok: false; status: 404 | 409; reason: string };

const blocked = (reason: string, status: 404 | 409 = 409): ShipBlocked => ({ ok: false, status, reason });

const sameVersions = (a: Record<string, string>, b: Record<string, string>) =>
  Object.keys(a).length === Object.keys(b).length && Object.entries(a).every(([k, v]) => b[k] === v);

/**
 * "A Change cannot be shipped until Architect has verified its behavior." Read-only: decides whether a change may
 * ship using the verification results already recorded. It never runs or re-judges anything.
 */
export async function checkShipGate(db: Db, changeId: string): Promise<ShipReady | ShipBlocked> {
  const [change] = await db.select().from(changes).where(eq(changes.id, changeId));
  if (!change) return blocked("Change not found.", 404);

  switch (change.status) {
    case "proposed":
      return blocked("This change is still being verified.");
    case "structural_failed":
      return blocked("This change failed structural verification, so it can't ship.");
    case "behavioral_failed":
      return blocked("This change failed behavioral verification: a protected scenario fails. Resolve it before shipping.");
    case "verified":
      return blocked("This change is verified but not applied. Apply it to the live agents first.");
  }
  if (!change.structural?.length || !change.structural.every((c) => c.ok))
    return blocked("This change has no passing structural verification on record.");

  const [verificationRun] = await db
    .select()
    .from(runs)
    .where(eq(runs.changeId, change.id))
    .orderBy(desc(runs.startedAt))
    .limit(1);
  if (!verificationRun?.results?.length || verificationRun.status !== "passed" || verificationRun.results.some((r) => r.status !== "pass"))
    return blocked("This change has no passing behavioral verification run on record.");

  // Ship exactly what was verified: the live agents must still be the version set the change was verified with.
  const live = Object.fromEntries(Object.entries(await loadCurrentVersions(db, change.projectId)).map(([k, v]) => [k, v.versionId]));
  if (!sameVersions(live, verificationRun.versionIds))
    return blocked("The live agents have changed since this change was verified (a later change was applied). Ship the latest change instead.");

  const [liveRun] = await db
    .select()
    .from(runs)
    .where(and(eq(runs.projectId, change.projectId), isNull(runs.changeId)))
    .orderBy(desc(runs.startedAt))
    .limit(1);
  // Both timestamps come from the database clock (defaultNow), so app/DB clock skew can't reorder them.
  const [applied] = await db
    .select({ at: events.createdAt })
    .from(events)
    .where(and(eq(events.changeId, change.id), eq(events.type, "change.applied")))
    .orderBy(desc(events.seq))
    .limit(1);
  if (!liveRun || liveRun.startedAt < (applied?.at ?? change.updatedAt))
    return blocked("Scenarios haven't run against the live agents since this change was applied. Run scenarios first.");
  if (liveRun.status === "running") return blocked("Scenarios are still running against the live agents.");
  if (!sameVersions(liveRun.versionIds, live)) return blocked("The latest scenario run doesn't match the live agents. Run scenarios again.");

  // Every live rule must pass on the live agents: no unresolved failed scenario, including rules changed since.
  const scenarios = await loadScenarios(db, change.projectId);
  for (const s of scenarios) {
    const result = liveRun.results?.find((r) => r.scenarioKey === s.key);
    if (!result || result.scenarioVersionId !== s.versionId)
      return blocked(`The rule "${s.name}" (v${s.version}) hasn't been checked against the live agents yet. Run scenarios first.`);
    if (result.status !== "pass") return blocked(`"${s.name}" is failing against the live agents. Resolve it before shipping.`);
  }

  return { ok: true, change, verificationRun, liveRun, scenarios };
}
