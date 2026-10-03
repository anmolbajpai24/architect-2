import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Workspace } from "@/components/workspace/workspace";
import { openProject } from "@/server/access";
import { getDb } from "@/server/context";
import { getWorkspace } from "@/server/workspace";

type Params = { searchParams: Promise<{ [key: string]: string | string[] | undefined }> };

const selectorFrom = (params: Record<string, string | string[] | undefined>) =>
  typeof params.project === "string" && params.project.trim() ? params.project.trim() : null;

/** Named after the project being viewed, whichever one that is. */
export async function generateMetadata({ searchParams }: Params): Promise<Metadata> {
  try {
    const { db } = await getDb();
    const project = await openProject(db, selectorFrom(await searchParams));
    return { title: `Architect · ${project.name}` };
  } catch {
    return { title: "Architect" };
  }
}

/**
 * The workspace, for any project: the one named by `?project=` (an id or a slug) or the configured one.
 * Nothing below this point knows which kind of project it is looking at.
 */
export default async function WorkspacePage({ searchParams }: Params) {
  await connection();
  const params = await searchParams;
  const { db, kind } = await getDb();

  // notFound() for both "no such project" and "not yours": the page is a door, the API is the lock.
  const project = await openProject(db, selectorFrom(params)).catch(() => null);
  if (!project) notFound();

  const snapshot = await getWorkspace(db, project, kind);
  const change = params.change;
  const prompt = params.prompt;
  const initialChangeId = typeof change === "string" && snapshot.changes.some((c) => c.id === change) ? change : null;
  const initialPrompt = typeof prompt === "string" ? prompt.trim().slice(0, 2000) : null;
  return <Workspace initial={snapshot} initialChangeId={initialChangeId} initialPrompt={initialPrompt || null} />;
}
