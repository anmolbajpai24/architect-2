import { connection } from "next/server";
import { Workspace } from "@/components/workspace/workspace";
import { getDb, getProjectId } from "@/server/context";
import { getWorkspace } from "@/server/workspace";

export default async function Page() {
  await connection();
  const { db, kind } = await getDb();
  const snapshot = await getWorkspace(db, await getProjectId(db), kind);
  return <Workspace initial={snapshot} />;
}
