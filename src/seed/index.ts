import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { agents, agentVersions, catalogItems, projects, scenarios, scenarioVersions } from "@/db/schema";
import { emit } from "@/events";
import { seedAgents } from "./agents";
import { catalog } from "./catalog";
import { seedScenarios } from "./scenarios";

export const DEMO_PROJECT_SLUG = "laptop-advisor";
export const DEMO_PROJECT_NAME = "Laptop Advisor";

/**
 * Seeds the demo project: catalog, three agents with v1 AgentVersions, and the initial scenarios.
 * With reset, the demo project is deleted first (cascades to its agents, versions, scenarios, changes, runs, events).
 * Returns the project id.
 */
export async function seedDemo(db: Db, { reset = false }: { reset?: boolean } = {}): Promise<string> {
  const [existing] = await db.select().from(projects).where(eq(projects.slug, DEMO_PROJECT_SLUG));
  if (existing && !reset) {
    // Agents, scenarios and history are left exactly as the user left them. The catalog is immutable fixture
    // data, so it is restored when it is missing — e.g. on a durable database whose rows predate project
    // ownership of the catalog (drizzle/0005) and were not attributable.
    await ensureCatalog(db, existing.id);
    return existing.id;
  }
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

/** Inserts the project's catalog if it has none. Cheap enough to check on every boot, and a no-op in the normal case. */
async function ensureCatalog(db: Db, projectId: string): Promise<void> {
  const [row] = await db
    .select({ sku: catalogItems.sku })
    .from(catalogItems)
    .where(eq(catalogItems.projectId, projectId))
    .limit(1);
  if (row) return;
  await db.insert(catalogItems).values(catalog.map((item) => ({ ...item, projectId })));
}

async function seedTransaction(db: Db, existingId: string | undefined): Promise<string> {
  return db.transaction(async (tx) => {
    if (existingId) await tx.delete(projects).where(eq(projects.id, existingId));

    const [project] = await tx
      .insert(projects)
      .values({ slug: DEMO_PROJECT_SLUG, name: DEMO_PROJECT_NAME })
      .returning();

    // The catalog belongs to this project: deleting the project cascades to it, and no other project sees it.
    await tx.delete(catalogItems).where(eq(catalogItems.projectId, project.id));
    await tx.insert(catalogItems).values(catalog.map((item) => ({ ...item, projectId: project.id })));

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
