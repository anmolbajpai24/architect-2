import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { PreviewChat, type PreviewTool } from "@/components/preview/preview-chat";
import { hasDefinition } from "@/projects/registry";
import { loadPreviewAgents } from "@/preview/session";
import { agentRuntimeProblem } from "@/server/config";
import { openProject } from "@/server/access";
import { getDb, getModes } from "@/server/context";

type Params = { params: Promise<{ projectId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  try {
    const { db } = await getDb();
    const project = await openProject(db, (await params).projectId);
    return { title: `${project.name} · Preview` };
  } catch {
    return { title: "Preview" };
  }
}

/**
 * The generated application, at its own URL, running its own agents.
 *
 * This page is the whole of "deployment" in the prototype: the project is already executable — its agents are
 * rows, and `runSystem` runs them — so previewing it needs a surface, not a sandbox. docs/architecture.md says
 * what a production preview would add and why none of it is here.
 */
export default async function PreviewPage({ params }: Params) {
  await connection();
  const { projectId } = await params;
  const { db } = await getDb();

  const project = await openProject(db, projectId).catch(() => null);
  if (!project) notFound();

  const agents = await loadPreviewAgents(db, project.id);
  const tools: PreviewTool[] = project.runtime.tools.names.map((name) => ({
    name,
    resultSummary: project.runtime.tools.resultSummaries[name] ?? null,
  }));

  return (
    <PreviewChat
      project={{
        id: project.id,
        name: project.name,
        origin: hasDefinition(project.slug) ? "definition" : "brief",
      }}
      agents={agents}
      tools={tools}
      mode={getModes().mode}
      problem={agentRuntimeProblem(project.runtime)}
    />
  );
}
