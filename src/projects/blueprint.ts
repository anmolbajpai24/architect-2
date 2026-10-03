import { z } from "zod";
import { Operator, type AgentConfig, type Assertion } from "@/domain/schemas";
import { schemaHasPath } from "@/verify/structural";

/**
 * A project as the planner describes it, before anything is written to the database.
 *
 * The blueprint is deliberately narrower than the domain model: it says what an agent produces in terms of
 * named fields rather than JSON Schema, and it only allows the checks a brand-new project can actually run.
 * `normalizeBlueprint` then turns a plausible blueprint into a provably runnable one — the LLM proposes, this
 * module disposes — and every repair it makes is reported, so the user approves what will really be built.
 */

// ---- What the planner returns ------------------------------------------------------------------------------

export const FieldType = z.enum(["string", "number", "boolean", "string[]"]);
export type FieldType = z.infer<typeof FieldType>;

export const BlueprintField = z.object({
  name: z.string().describe("snake_case field name, e.g. refund_amount_usd"),
  type: FieldType,
  nullable: z.boolean().describe("True when the agent may legitimately leave it empty."),
  description: z.string().describe("What this field holds, for the agent and for the reader."),
});
export type BlueprintField = z.infer<typeof BlueprintField>;

export const BlueprintAgent = z.object({
  key: z.string().describe("kebab-case identifier, e.g. order-analyst"),
  name: z.string().describe("Display name, e.g. Order Analyst"),
  role: z.string().describe("One line: what this agent is for."),
  instructions: z.string().describe("The agent's full system instructions, in the second person."),
  output: z.array(BlueprintField).min(1).describe("The structured fields this agent returns."),
});
export type BlueprintAgent = z.infer<typeof BlueprintAgent>;

/**
 * The checks a generated project can make. Tool assertions are absent on purpose: a generated project
 * registers no tools (see src/projects/registry.ts), so a tool check could never pass.
 */
export const BlueprintCheck = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("output"),
    agent: z.string().describe("The agent key whose output is checked."),
    path: z.string().describe("A field of that agent's output, e.g. should_escalate or unmet_conditions.0"),
    op: Operator,
    value: z
      .union([z.string(), z.number(), z.boolean()])
      .nullable()
      .describe("The value to compare against; null for exists and is_null."),
    description: z.string().describe("The check in the owner's words."),
  }),
  z.object({
    type: z.literal("judge"),
    agent: z.string().describe("The agent key whose output a model judges."),
    criterion: z.string().describe("One sentence a strict evaluator can rule on."),
  }),
]);
export type BlueprintCheck = z.infer<typeof BlueprintCheck>;

export const BlueprintScenario = z.object({
  name: z.string().describe("Short title, e.g. Refund outside policy"),
  intent: z.string().describe("The behavior this protects, in the owner's words."),
  message: z.string().describe("A realistic input message from a user of the application."),
  checks: z.array(BlueprintCheck).min(1),
});
export type BlueprintScenario = z.infer<typeof BlueprintScenario>;

export const ProjectBlueprint = z.object({
  name: z.string().describe("Short product name, e.g. Support Desk"),
  summary: z.string().describe("One sentence describing what this application does, in the third person."),
  agents: z
    .array(BlueprintAgent)
    .min(1)
    .max(5)
    .describe("The entry agent first, then the agents it delegates to, in the order they should run."),
  responseField: z.string().describe("The field of the entry agent's output that holds the user-facing reply."),
  scenarios: z.array(BlueprintScenario).min(1).max(6),
});
export type ProjectBlueprint = z.infer<typeof ProjectBlueprint>;

/** A blueprint that has been through `normalizeBlueprint`: runnable as written, with its keys settled. */
export type NormalizedBlueprint = Omit<ProjectBlueprint, "scenarios"> & {
  slug: string;
  scenarios: (BlueprintScenario & { key: string })[];
};

// ---- Normalization -----------------------------------------------------------------------------------------

const slugify = (text: string, fallback: string): string => {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || fallback;
};

const fieldName = (text: string, fallback: string): string => {
  const name = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  return /^[a-z]/.test(name) ? name : fallback;
};

function unique(candidate: string, taken: Set<string>): string {
  let key = candidate;
  for (let n = 2; taken.has(key); n++) key = `${candidate}-${n}`;
  taken.add(key);
  return key;
}

const jsonType = (field: BlueprintField) => {
  const base = field.type === "string[]" ? { type: "array", items: { type: "string" } } : { type: field.type };
  if (!field.nullable) return { ...base, description: field.description };
  return field.type === "string[]"
    ? { ...base, description: field.description }
    : { type: [field.type, "null"], description: field.description };
};

/** The JSON Schema an AgentVersion stores, built from declared fields rather than asked for as JSON Schema. */
export function outputSchemaFor(fields: BlueprintField[]): AgentConfig["outputSchema"] {
  const properties = Object.fromEntries(fields.map((f) => [f.name, jsonType(f)]));
  return { type: "object", properties, required: fields.map((f) => f.name), additionalProperties: false };
}

export function toAssertion(check: BlueprintCheck): Assertion {
  if (check.type === "judge") return { type: "judge", agent: check.agent, criterion: check.criterion };
  const { agent, path, op, value, description } = check;
  return op === "exists" || op === "is_null"
    ? { type: "output", agent, path, op, description }
    : { type: "output", agent, path, op, value: value ?? null, description };
}

/**
 * Makes a blueprint runnable, and says what it had to change.
 *
 * The repairs are the shape of the runtime, not taste: `runSystem` executes the entry agent's direct handoffs
 * and then the entry agent, so a generated system is exactly one level deep; `checkStructure` requires every
 * assertion to resolve against an agent's output schema, so checks that don't are dropped rather than shipped
 * as a project that cannot pass its own structural verification.
 */
export function normalizeBlueprint(raw: ProjectBlueprint, takenSlugs: string[] = []): { blueprint: NormalizedBlueprint; notes: string[] } {
  const notes: string[] = [];

  const name = raw.name.trim() || "New project";
  const slug = unique(slugify(name, "project"), new Set(takenSlugs));

  // Agent keys: stable, kebab-case, unique. The first agent is the entry agent.
  const agentKeys = new Set<string>();
  const agents = raw.agents.map((agent, i) => {
    const key = unique(slugify(agent.key || agent.name, `agent-${i + 1}`), agentKeys);
    const fieldNames = new Set<string>();
    const output = agent.output.map((field, j) => {
      const fieldKey = fieldName(field.name, `field_${j + 1}`);
      const deduped = fieldNames.has(fieldKey) ? `${fieldKey}_${j + 1}` : fieldKey;
      fieldNames.add(deduped);
      return { ...field, name: deduped };
    });
    return { ...agent, key, name: agent.name.trim() || key, output };
  });

  // The entry agent runs every other agent, in order, then composes the reply: the only shape runSystem runs.
  const entry = agents[0];

  // The user-facing reply has to be a plain string on the entry agent, because that is what the workspace shows.
  let responseField = fieldName(raw.responseField, "");
  const isReply = (f: BlueprintField) => f.type === "string" && !f.nullable;
  if (!entry.output.some((f) => f.name === responseField && isReply(f))) {
    const fallback = entry.output.find(isReply);
    if (fallback) {
      responseField = fallback.name;
      notes.push(`Used "${fallback.name}" as ${entry.name}'s reply to the user.`);
    } else {
      responseField = "reply";
      entry.output.unshift({
        name: "reply",
        type: "string",
        nullable: false,
        description: "The reply shown to the user.",
      });
      notes.push(`Added a "reply" field to ${entry.name}: the entry agent needs one to answer the user.`);
    }
  }

  // Checks have to resolve against the agents that now exist, or structural verification would reject them.
  const schemas = new Map(agents.map((a) => [a.key, outputSchemaFor(a.output)]));
  const byKey = new Map(agents.map((a) => [a.key, a]));
  const resolveAgent = (key: string) =>
    byKey.has(key) ? key : agents.find((a) => slugify(a.name, "?") === slugify(key, "!"))?.key;

  const scenarioKeys = new Set<string>();
  const scenarios = raw.scenarios.map((scenario, i) => {
    const checks: BlueprintCheck[] = [];
    for (const check of scenario.checks) {
      const agentKey = resolveAgent(check.agent);
      if (!agentKey) {
        notes.push(`Dropped a check in "${scenario.name}": it named an agent that isn't in this system.`);
        continue;
      }
      if (check.type === "output" && !schemaHasPath(schemas.get(agentKey), check.path)) {
        notes.push(`Dropped a check in "${scenario.name}": ${byKey.get(agentKey)!.name} has no "${check.path}".`);
        continue;
      }
      checks.push({ ...check, agent: agentKey });
    }
    if (checks.length === 0) {
      checks.push({ type: "judge", agent: entry.key, criterion: scenario.intent });
      notes.push(`"${scenario.name}" is protected by its stated intent alone: its specific checks didn't resolve.`);
    }
    return {
      ...scenario,
      key: unique(slugify(scenario.name, `scenario-${i + 1}`), scenarioKeys),
      name: scenario.name.trim() || `Scenario ${i + 1}`,
      checks,
    };
  });

  return { blueprint: { ...raw, name, slug, agents, responseField, scenarios }, notes };
}

// ---- Turning a normalized blueprint into domain objects -----------------------------------------------------

/** The agent system, in the order it runs: the entry agent delegates to the rest, which is what runSystem runs. */
export function blueprintAgents(blueprint: NormalizedBlueprint, model: string): { key: string; config: AgentConfig }[] {
  const delegates = blueprint.agents.slice(1).map((a) => a.key);
  return blueprint.agents.map((agent, i) => ({
    key: agent.key,
    config: {
      name: agent.name,
      role: agent.role,
      model,
      instructions: agent.instructions,
      tools: [],
      handoffs: i === 0 ? delegates : [],
      outputSchema: outputSchemaFor(agent.output),
    },
  }));
}

export function blueprintScenarios(blueprint: NormalizedBlueprint) {
  return blueprint.scenarios.map((s) => ({
    key: s.key,
    name: s.name,
    intent: s.intent,
    input: { message: s.message },
    assertions: s.checks.map(toAssertion),
  }));
}
