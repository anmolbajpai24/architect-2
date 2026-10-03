import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { agents, agentVersions, projects, scenarios, scenarioVersions } from "@/db/schema";
import type { VersionSet } from "@/domain/schemas";
import { emit } from "@/events";
import { EMPTY_TOOL_REGISTRY } from "@/runtime/tool-registry";
import { checkStructure } from "@/verify/structural";
import { blueprintAgents, blueprintScenarios, type NormalizedBlueprint } from "./blueprint";

/**
 * The materializer: a normalized blueprint becomes rows.
 *
 * It is the only thing that writes a generated project, and it writes nothing the engine doesn't already
 * understand — the same `projects` / `agents` / `agent_versions` / `scenarios` / `scenario_versions` tables the
 * seeded reference project uses, with the same v1-is-immutable shape. The blueprint is not stored as a blob:
 * once materialized, the domain rows are the project, and the brief is kept only as provenance.
 *
 * Nothing the planner said is taken on trust. Structural verification runs here, against the configuration about
 * to be written, and a project that would fail it is never created.
 */

/** A blueprint that can't become a project; the message is meant for the user. */
export class MaterializeError extends Error {}

export type MaterializedProject = { projectId: string; slug: string; name: string; agents: number; scenarios: number };

/** A free slug, so two projects planned from similar briefs don't collide. */
async function freeSlug(db: Db, wanted: string): Promise<string> {
  const taken = new Set((await db.select({ slug: projects.slug }).from(projects)).map((p) => p.slug));
  if (!taken.has(wanted)) return wanted;
  for (let n = 2; n < 100; n++) if (!taken.has(`${wanted}-${n}`)) return `${wanted}-${n}`;
  return `${wanted}-${Date.now().toString(36)}`;
}

export async function materializeProject(
  db: Db,
  input: { blueprint: NormalizedBlueprint; brief: string; model: string; notes?: string[]; ownerId: string | null },
): Promise<MaterializedProject> {
  const { blueprint } = input;
  const agentSpecs = blueprintAgents(blueprint, input.model);
  const scenarioSpecs = blueprintScenarios(blueprint);

  // The same check every proposed change goes through, run before the project exists rather than after.
  // A generated project registers no tools, so the empty registry is the truth, not a stand-in.
  const versions: VersionSet = Object.fromEntries(
    agentSpecs.map((a) => [a.key, { versionId: `pending:${a.key}`, config: a.config }]),
  );
  const structural = checkStructure(versions, scenarioSpecs, EMPTY_TOOL_REGISTRY);
  const failed = structural.filter((c) => !c.ok);
  if (failed.length > 0) {
    throw new MaterializeError(
      `Architect planned a system it can't run, so nothing was created: ${failed.map((c) => c.message).join("; ")}`,
    );
  }

  const slug = await freeSlug(db, blueprint.slug);

  return db.transaction(async (tx) => {
    const [project] = await tx
      .insert(projects)
      .values({
        slug,
        name: blueprint.name,
        brief: input.brief,
        judgeContext: blueprint.summary,
        responsePath: blueprint.responseField,
        ownerId: input.ownerId,
      })
      .returning();

    for (const { key, config } of agentSpecs) {
      const [agent] = await tx.insert(agents).values({ projectId: project.id, key, name: config.name }).returning();
      const [version] = await tx.insert(agentVersions).values({ agentId: agent.id, version: 1, config }).returning();
      await tx.update(agents).set({ currentVersionId: version.id }).where(eq(agents.id, agent.id));
    }

    // now() is constant inside a transaction, so give each scenario its own timestamp to keep their order stable.
    const createdAt = Date.now();
    for (const [i, { key, ...content }] of scenarioSpecs.entries()) {
      const [scenario] = await tx
        .insert(scenarios)
        .values({ projectId: project.id, key, createdAt: new Date(createdAt + i) })
        .returning();
      const [version] = await tx
        .insert(scenarioVersions)
        .values({ scenarioId: scenario.id, version: 1, ...content, appliedAt: new Date() })
        .returning();
      await tx.update(scenarios).set({ currentVersionId: version.id }).where(eq(scenarios.id, scenario.id));
    }

    await emit(tx, {
      projectId: project.id,
      type: "project.created",
      payload: {
        agents: agentSpecs.length,
        scenarios: scenarioSpecs.length,
        model: input.model,
        notes: input.notes ?? [],
      },
    });

    return {
      projectId: project.id,
      slug,
      name: project.name,
      agents: agentSpecs.length,
      scenarios: scenarioSpecs.length,
    };
  });
}
