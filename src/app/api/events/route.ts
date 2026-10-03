import { and, asc, eq, gt } from "drizzle-orm";
import { events } from "@/db/schema";
import { getDb, getProjectId } from "@/server/context";
import { toWorkspaceEvent } from "@/server/workspace";

export const maxDuration = 60;

/** A stream is closed well before the function's time limit, so the browser reconnects instead of being cut off. */
const STREAM_MS = 50_000;
const HEARTBEAT_MS = 15_000;
/** Postgres is a network round trip per poll; the in-process database is free, so the demo can feel instant. */
const pollMs = (kind: string) => (kind === "postgres" ? 500 : 250);

/**
 * Server-Sent Events over the append-only events table. Polling keeps it identical on PGlite and Supabase, and
 * keeps the server stateless: every client resumes from a sequence number, not from a subscription.
 *
 * Resumes from ?after=<seq>, or from the browser's Last-Event-ID on reconnect. A `sync` event (no payload, not
 * surfaced to the UI) gives the browser a Last-Event-ID immediately, so a reconnect can't re-deliver events the
 * client already has.
 */
export async function GET(req: Request) {
  const { db, kind } = await getDb();
  const url = new URL(req.url);
  let last = Number(req.headers.get("last-event-id") ?? url.searchParams.get("after") ?? 0) || 0;
  const encoder = new TextEncoder();
  const interval = pollMs(kind);

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      req.signal.addEventListener("abort", () => (closed = true));
      const send = (chunk: string) => {
        if (!closed) controller.enqueue(encoder.encode(chunk));
      };
      const sync = () => send(`id: ${last}\nevent: sync\ndata: {}\n\n`);

      send("retry: 1000\n\n");
      sync();
      const deadline = Date.now() + STREAM_MS;
      let idle = 0;
      while (!closed && Date.now() < deadline) {
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
        idle = rows.length ? 0 : idle + interval;
        if (idle >= HEARTBEAT_MS) {
          sync();
          idle = 0;
        }
        await new Promise((r) => setTimeout(r, interval));
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
