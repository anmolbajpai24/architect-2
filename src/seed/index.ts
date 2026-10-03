import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { agents, agentVersions, catalogItems, projects, scenarios, scenarioVersions } from "@/db/schema";
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
  try {
    return await seedTransaction(db, existing?.id);
  } catch (err) {
    // On a shared database two cold-starting instances can seed at the same moment. The unique slug settles it;
    // the one that lost simply reads the project the other created.
    if (reset) throw err;
    const [winner] = await db.select().from(projects).where(eq(projects.slug, DEMO_PROJECT_SLUG));
    if (winner) return winner.id;
    throw err;
  }
}

async function seedTransaction(db: Db, existingId: string | undefined): Promise<string> {
  return db.transaction(async (tx) => {
    if (existingId) await tx.delete(projects).where(eq(projects.id, existingId));

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

    // now() is constant inside a transaction, so give each scenario its own timestamp to keep their order stable.
    const seededAt = Date.now();
    for (const [i, { key, ...content }] of seedScenarios.entries()) {
      const [scenario] = await tx
        .insert(scenarios)
        .values({ projectId: project.id, key, createdAt: new Date(seededAt + i) })
        .returning();
      const [version] = await tx
        .insert(scenarioVersions)
        .values({ scenarioId: scenario.id, version: 1, ...content, appliedAt: new Date() })
        .returning();
      await tx.update(scenarios).set({ currentVersionId: version.id }).where(eq(scenarios.id, scenario.id));
    }

    await emit(tx, {
      projectId: project.id,
      type: "project.seeded",
      payload: { agents: seedAgents.length, scenarios: seedScenarios.length, catalogItems: catalog.length },
    });
    return project.id;
  });
}
