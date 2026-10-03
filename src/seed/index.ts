import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { agents, agentVersions, catalogItems, projects, scenarios } from "@/db/schema";
import { emit } from "@/events";
import { seedAgents } from "./agents";
import { catalog } from "./catalog";
import { seedScenarios } from "./scenarios";

export const DEMO_PROJECT_SLUG = "laptop-advisor";

/**
 * Seeds the demo project: catalog, three agents with v1 AgentVersions, and the initial scenarios.
 * With reset, the demo project is deleted first (cascades to its agents, versions, scenarios, changes, runs, events).
 * Returns the project id.
 */
export async function seedDemo(db: Db, { reset = false } = {}): Promise<string> {
  const [existing] = await db.select().from(projects).where(eq(projects.slug, DEMO_PROJECT_SLUG));
  if (existing && !reset) return existing.id;

  return db.transaction(async (tx) => {
    if (existing) await tx.delete(projects).where(eq(projects.id, existing.id));

    await tx.delete(catalogItems);
    await tx.insert(catalogItems).values(catalog);

    const [project] = await tx
      .insert(projects)
      .values({ slug: DEMO_PROJECT_SLUG, name: "Laptop Advisor" })
      .returning();

    for (const { key, config } of seedAgents) {
      const [agent] = await tx.insert(agents).values({ projectId: project.id, key, name: config.name }).returning();
      const [version] = await tx.insert(agentVersions).values({ agentId: agent.id, version: 1, config }).returning();
      await tx.update(agents).set({ currentVersionId: version.id }).where(eq(agents.id, agent.id));
    }

    await tx.insert(scenarios).values(seedScenarios.map((s) => ({ ...s, projectId: project.id })));

    await emit(tx, {
      projectId: project.id,
      type: "project.seeded",
      payload: { agents: seedAgents.length, scenarios: seedScenarios.length, catalogItems: catalog.length },
    });
    return project.id;
  });
}
