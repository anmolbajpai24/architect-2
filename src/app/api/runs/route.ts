import { loadCurrentVersions, runScenarios } from "@/scenarios/runner";
import { getDb, getModes, getProjectId, startJob } from "@/server/context";
import { busyResponse } from "@/server/responses";

/** Runs every scenario against the live agents, in the background. */
export async function POST() {
  const { db } = await getDb();
  const projectId = await getProjectId(db);
  const started = startJob(db, projectId, "Running scenarios", async () =>
    runScenarios(db, {
      projectId,
      versions: await loadCurrentVersions(db, projectId),
      trigger: "manual",
      ...getModes(),
    }),
  );
  return started ? Response.json({ ok: true }, { status: 202 }) : busyResponse();
}
