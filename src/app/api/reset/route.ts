import { bootstrapProject, busyJob, getDb } from "@/server/context";
import { busyResponse } from "@/server/responses";

/** Restores the configured project to its seeded state: v1 agents, no changes or runs. */
export async function POST() {
  if (busyJob()) return busyResponse();
  const { db } = await getDb();
  await bootstrapProject(db, { reset: true });
  return Response.json({ ok: true });
}
