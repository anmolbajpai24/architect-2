import type { Db } from "@/db/client";
import { events } from "@/db/schema";

export type EventInput = {
  projectId: string;
  runId?: string;
  changeId?: string;
  type: string;
  payload?: Record<string, unknown>;
};

export async function emit(db: Db, e: EventInput) {
  await db.insert(events).values({
    projectId: e.projectId,
    runId: e.runId ?? null,
    changeId: e.changeId ?? null,
    type: e.type,
    payload: e.payload ?? {},
  });
}
