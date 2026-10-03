import type { projects } from "@/db/schema";
import { laptopAdvisor } from "@/demo/project";
import { createToolRegistry, EMPTY_TOOL_REGISTRY } from "@/runtime/tool-registry";
import { ConfigError, serverEnv } from "@/server/env";
import type { ProjectDefinition, ProjectRuntime } from "./types";

/**
 * The projects this server knows how to run, and how one is chosen.
 *
 * There are two kinds, and the difference is only how much of a project is code. A project whose slug names a
 * definition here is backed by code: its tools and its deterministic simulator are functions, so they cannot come
 * out of a database. Every other project was created from a brief and is entirely data — rows in `projects`,
 * `agents` and `scenarios` — which is what makes the engine's genericity worth anything.
 *
 * `ARCHITECT_PROJECT` names the project served when a request doesn't name one, defaulting to the seeded Laptop
 * Advisor reference project. Choosing a *definition* is pure configuration (no database), so it stays safe to
 * call from anywhere on the server.
 */

const DEFINITIONS: ProjectDefinition[] = [laptopAdvisor];

export const DEFAULT_PROJECT_SLUG = laptopAdvisor.slug;

export function knownProjectSlugs(): string[] {
  return DEFINITIONS.map((d) => d.slug);
}

/** The configured project's slug. */
export function configuredProjectSlug(): string {
  return serverEnv().ARCHITECT_PROJECT ?? DEFAULT_PROJECT_SLUG;
}

/** The configured project's definition. Loud on an unknown slug: silently serving another project would mislead. */
export function projectDefinition(slug: string = configuredProjectSlug()): ProjectDefinition {
  const definition = DEFINITIONS.find((d) => d.slug === slug);
  if (!definition) {
    throw new ConfigError(
      `ARCHITECT_PROJECT names an unknown project "${slug}". Known projects: ${knownProjectSlugs().join(", ")}.`,
    );
  }
  return definition;
}

/** A definition with its tools built into a registry: everything the engine needs to run that project. */
export function toProjectRuntime(definition: ProjectDefinition): ProjectRuntime {
  const { tools, seed: _seed, ...rest } = definition;
  return { ...rest, tools: createToolRegistry(tools) };
}

/** The configured project, ready to run. */
export function projectRuntime(slug?: string): ProjectRuntime {
  return toProjectRuntime(projectDefinition(slug));
}

export type ProjectRow = typeof projects.$inferSelect;

/** Whether a persisted project is backed by a definition in code. */
export function hasDefinition(slug: string): boolean {
  return DEFINITIONS.some((d) => d.slug === slug);
}

/**
 * The runtime of a persisted project.
 *
 * A project backed by a definition gets that definition, unchanged — Laptop Advisor keeps its catalog tool and
 * its simulator. A project created from a brief carries its own facts in its row and gets an honest runtime for
 * what it actually is: no tools, because nothing could execute them, and no simulator, so Demo mode reports that
 * it cannot run this project rather than replaying something that was never recorded.
 */
export function runtimeFromRow(row: ProjectRow): ProjectRuntime {
  if (hasDefinition(row.slug)) return toProjectRuntime(projectDefinition(row.slug));
  return {
    slug: row.slug,
    name: row.name,
    tools: EMPTY_TOOL_REGISTRY,
    judgeContext: row.judgeContext ?? undefined,
    responsePath: row.responsePath ?? undefined,
  };
}
