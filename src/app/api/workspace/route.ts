import { connection } from "next/server";
import { getDb, getProjectId } from "@/server/context";
import { getWorkspace } from "@/server/workspace";

export async function GET() {
  await connection();
  const { db, kind } = await getDb();
  return Response.json(await getWorkspace(db, await getProjectId(db), kind));
}
