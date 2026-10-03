import { and, asc, eq, gt } from "drizzle-orm";
import { events } from "@/db/schema";
import { getDb, getProjectId } from "@/server/context";
import { toWorkspaceEvent } from "@/server/workspace";

const POLL_MS = 250;
const HEARTBEAT_MS = 15_000;

/**
 * Server-Sent Events over the append-only events table. Polling keeps it identical on PGlite and Supabase.
 * Resumes from ?after=<seq>, or from the browser's Last-Event-ID on reconnect.
 */
export async function GET(req: Request) {
  const { db } = await getDb();
  const url = new URL(req.url);
  let last = Number(req.headers.get("last-event-id") ?? url.searchParams.get("after") ?? 0) || 0;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      req.signal.addEventListener("abort", () => (closed = true));
      const send = (chunk: string) => {
        if (!closed) controller.enqueue(encoder.encode(chunk));
      };
      send("retry: 1000\n\n");
      let idle = 0;
      while (!closed) {
        // Re-resolved each tick so a demo reset (new project id) is followed transparently.
        const projectId = await getProjectId(db);
        const rows = await db
          .select()
          .from(events)
          .where(and(eq(events.projectId, projectId), gt(events.seq, last)))
          .orderBy(asc(events.seq))
          .limit(200);
        for (const row of rows) {
          send(`id: ${row.seq}\ndata: ${JSON.stringify(toWorkspaceEvent(row))}\n\n`);
          last = row.seq;
        }
        idle = rows.length ? 0 : idle + POLL_MS;
        if (idle >= HEARTBEAT_MS) {
          send(": heartbeat\n\n");
          idle = 0;
        }
        await new Promise((r) => setTimeout(r, POLL_MS));
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
