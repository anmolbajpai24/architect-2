import { tool, type ToolSet } from "ai";
import { z } from "zod";
import type { Db } from "@/db/client";
import type { ToolResultSummary } from "@/domain/schemas";

/**
 * The generic tool registry. A project declares its tools as data (ToolDefinition); the engine never names one.
 *
 * Everything the rest of Architect needs to know about tools comes from a registry built here: the runtime builds
 * the AI SDK ToolSet for an agent's `tools` list, structural verification validates `args.*` assertion paths
 * against the input fields, and both proposers describe the available tools to the model.
 */

/**
 * What a tool needs in order to run. `projectId` is part of it because a tool reads that project's own data:
 * two projects with a `search_catalog` tool must not see each other's rows.
 */
export type ToolContext = { db: Db; projectId: string };

export type ToolDefinition<Input = any, Result = unknown> = {
  name: string;
  /** Shown to the model, and to the proposers when they describe what is available. */
  description: string;
  inputSchema: z.ZodType<Input>;
  /** Plain-language shape of the result, for anything that writes "result.*" assertion paths. */
  resultShape: string;
  /** Optional: how a result is summarized in the UI. Without it, results fall back to a generic summary. */
  resultSummary?: ToolResultSummary;
  /** The tool's implementation, bound to one project. The registry wraps it into the AI SDK tool. */
  build(ctx: ToolContext): (input: Input) => Promise<Result>;
};

export type ToolRegistry = {
  /** Registered tool names, in declaration order. Runtime values: a project's tools aren't known at compile time. */
  names: string[];
  has(name: string): boolean;
  descriptions: Record<string, string>;
  resultShapes: Record<string, string>;
  /** JSON Schema of each tool's input, for anything that writes "args.*" assertion paths. */
  inputSchemas: Record<string, unknown>;
  /** Top-level input field names per tool, derived from inputSchemas. Used to validate "args.<field>". */
  inputFields: Record<string, string[]>;
  /** How each tool's result is summarized for a human, where the tool says. */
  resultSummaries: Record<string, ToolResultSummary | undefined>;
  /** The AI SDK ToolSet for the named tools. Unknown names are dropped; structural verification rejects them. */
  build(ctx: ToolContext, names: string[]): ToolSet;
};

/** Top-level property names of a JSON Schema object, or [] if it has none. */
function propertyNames(schema: unknown): string[] {
  const properties = (schema as { properties?: Record<string, unknown> } | null)?.properties;
  return properties ? Object.keys(properties) : [];
}

export function createToolRegistry(definitions: ToolDefinition[]): ToolRegistry {
  const byName = new Map(definitions.map((d) => [d.name, d]));
  if (byName.size !== definitions.length) {
    const seen = new Set<string>();
    const duplicate = definitions.find((d) => (seen.has(d.name) ? true : (seen.add(d.name), false)));
    throw new Error(`Duplicate tool "${duplicate?.name}" in the project's tool registry.`);
  }
  const inputSchemas = Object.fromEntries(definitions.map((d) => [d.name, z.toJSONSchema(d.inputSchema)]));
  return {
    names: definitions.map((d) => d.name),
    has: (name) => byName.has(name),
    descriptions: Object.fromEntries(definitions.map((d) => [d.name, d.description])),
    resultShapes: Object.fromEntries(definitions.map((d) => [d.name, d.resultShape])),
    inputSchemas,
    inputFields: Object.fromEntries(definitions.map((d) => [d.name, propertyNames(inputSchemas[d.name])])),
    resultSummaries: Object.fromEntries(definitions.map((d) => [d.name, d.resultSummary])),
    build(ctx, names) {
      const entries = names.flatMap((name) => {
        const definition = byName.get(name);
        if (!definition) return [];
        const execute = definition.build(ctx);
        return [[name, tool({ description: definition.description, inputSchema: definition.inputSchema, execute })] as const];
      });
      return Object.fromEntries(entries);
    },
  };
}

/** A project with no tools. Agents can still run; any tool assertion fails structural verification. */
export const EMPTY_TOOL_REGISTRY: ToolRegistry = createToolRegistry([]);
