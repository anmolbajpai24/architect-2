import { laptopAdvisor } from "@/demo/project";
import { createToolRegistry } from "@/runtime/tool-registry";
import { ConfigError, serverEnv } from "@/server/env";
import type { ProjectDefinition, ProjectRuntime } from "./types";

/**
 * The projects this server knows how to run, and how one is chosen.
 *
 * Architect is single-project in this phase: `ARCHITECT_PROJECT` names which definition is served, defaulting to
 * the seeded Laptop Advisor reference project. Resolution is pure configuration — no database, no authentication,
 * no accounts — so it is safe to call from anywhere on the server, including metadata generation.
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
