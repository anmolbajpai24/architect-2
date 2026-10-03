import { connection } from "next/server";
import { Workspace } from "@/components/workspace/workspace";
import { getDb, getProjectId } from "@/server/context";
import { getWorkspace } from "@/server/workspace";

/** `?change=<id>` opens that change's verdict (the link Architect puts in a shipped pull request). */
export default async function Page({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  await connection();
  const { db, kind } = await getDb();
  const snapshot = await getWorkspace(db, await getProjectId(db), kind);
  const { change } = await searchParams;
  const initialChangeId = typeof change === "string" && snapshot.changes.some((c) => c.id === change) ? change : null;
  return <Workspace initial={snapshot} initialChangeId={initialChangeId} />;
}
