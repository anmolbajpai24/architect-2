import { connection } from "next/server";
import { getDb, projectSelector, resolveProject } from "@/server/context";
import { notFoundResponse } from "@/server/responses";
import { getWorkspace } from "@/server/workspace";

export async function GET(req: Request) {
  await connection();
  const { db, kind } = await getDb();
  try {
    return Response.json(await getWorkspace(db, await resolveProject(db, projectSelector(req)), kind));
  } catch (err) {
    return notFoundResponse(err);
  }
}
