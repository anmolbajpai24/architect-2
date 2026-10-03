import { and, eq, isNotNull } from "drizzle-orm";
import type { Db } from "@/db/client";
import { agents, agentVersions } from "@/db/schema";
import { entryResponse } from "@/domain/format";
import type { Trace } from "@/domain/schemas";
import type { ModelMode } from "@/runtime/models";
import { runSystem } from "@/runtime/run-system";
import { loadCurrentVersions } from "@/scenarios/runner";
import type { ResolvedProject } from "@/server/context";

/**
 * Preview: running a project's agent system against a message the user types, instead of against a scenario.
 *
 * There is no second runtime here. A preview turn is one `runSystem` call on the project's **live** agent
 * versions — the same function the verification engine calls, with the same tool registry and the same models —
 * so what the preview shows is what the scenarios check. That is the whole point: a preview that executed
 * something else would be a mock.
 *
 * What it deliberately does not do: nothing is written. A preview turn creates no `runs` row and emits no event,
 * because it is interaction, not verification, and the run history has to stay the record of what was verified.
 * Each turn re-reads the live versions, so a change applied in the workspace shows up on the very next message.
 */

/** One agent of the live system, as the preview names it. */
export type PreviewAgent = {
  key: string;
  name: string;
  version: number;
  /** The agent that answers the user; the others run before it and hand it their output. */
  entry: boolean;
  tools: string[];
};

export type PreviewTurn = {
  /** The entry agent's user-facing response, read through the project's `responsePath`. */
  reply: string | null;
  trace: Trace;
  /** The live lineup this turn actually ran, so the UI can show when a change has landed. */
  agents: PreviewAgent[];
};

/** The live agent system with version numbers, for the preview's header. */
export async function loadPreviewAgents(db: Db, projectId: string): Promise<PreviewAgent[]> {
  const rows = await db
    .select({
      key: agents.key,
      name: agents.name,
      version: agentVersions.version,
      config: agentVersions.config,
      createdAt: agents.createdAt,
    })
    .from(agents)
    .innerJoin(agentVersions, eq(agents.currentVersionId, agentVersions.id))
    .where(and(eq(agents.projectId, projectId), isNotNull(agents.currentVersionId)))
    .orderBy(agents.createdAt);

  const handoffTargets = new Set(rows.flatMap((r) => r.config.handoffs));
  return rows.map((r) => ({
    key: r.key,
    name: r.name,
    version: r.version,
    entry: !handoffTargets.has(r.key),
    tools: r.config.tools,
  }));
}

/** One turn: the live agents run on the message, and the entry agent's reply comes back with its trace. */
export async function runPreview(
  db: Db,
  project: ResolvedProject,
  message: string,
  mode: ModelMode,
): Promise<PreviewTurn> {
  const versions = await loadCurrentVersions(db, project.id);
  const trace = await runSystem(db, {
    projectId: project.id,
    versions,
    message,
    mode,
    runtime: project.runtime,
  });
  const lineup = await loadPreviewAgents(db, project.id);
  const entry = lineup.find((a) => a.entry);
  const reply = entry ? (entryResponse(trace.agents[entry.key]?.output, project.runtime.responsePath) ?? null) : null;
  return { reply, trace, agents: lineup };
}
