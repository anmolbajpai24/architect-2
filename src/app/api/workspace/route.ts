import { connection } from "next/server";
import { openProject, ProjectForbidden } from "@/server/access";
import { getDb, projectSelector } from "@/server/context";
import { forbiddenResponse, notFoundResponse } from "@/server/responses";
import { getWorkspace } from "@/server/workspace";

export async function GET(req: Request) {
  await connection();
  const { db, kind } = await getDb();
  try {
    return Response.json(await getWorkspace(db, await openProject(db, projectSelector(req)), kind));
  } catch (err) {
    return err instanceof ProjectForbidden ? forbiddenResponse(err) : notFoundResponse(err);
  }
}
