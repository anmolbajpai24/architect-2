import { busyJob, getDb } from "@/server/context";
import { busyResponse } from "@/server/responses";
import { seedDemo } from "@/seed";

/** Restores the demo project to its seeded state: v1 agents, no changes or runs. */
export async function POST() {
  if (busyJob()) return busyResponse();
  const { db } = await getDb();
  await seedDemo(db, { reset: true });
  return Response.json({ ok: true });
}
