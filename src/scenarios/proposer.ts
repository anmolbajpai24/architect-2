import { generateText, Output } from "ai";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { ProposalError, proposerConfig, resolveProposerModel, type ProposerConfig } from "@/changes/proposer";
import type { ScenarioProposal } from "@/db/schema";
import { describeAssertion } from "@/domain/format";
import { Assertion, Operator, type ScenarioInput, type ScenarioResult, type VersionSet } from "@/domain/schemas";
import type { ProjectRuntime } from "@/projects/types";
import type { ToolRegistry } from "@/runtime/tool-registry";
import { checkStructure } from "@/verify/structural";

/**
 * Architect's Scenario proposer, used for "Change the rule". It revises a Scenario (the requirement), never an
 * agent. Output is restricted to the existing Scenario model: tool / output / judge assertions with the existing
 * operators, real agents and registered tools. Anything it can't express that way comes back as an explanation.
 * Same live/fixture switch as the Change proposer (ARCHITECT_PROPOSER, ARCHITECT_PROPOSER_MODEL).
 */

export type ScenarioContent = { name: string; intent: string; input: ScenarioInput; assertions: Assertion[] };
export type ScenarioDraft = { content: ScenarioContent; proposal: ScenarioProposal };

export type CurrentScenario = ScenarioContent & { key: string; version: number };

// ---- Output contract -------------------------------------------------------------------------------------

function revisionSchema(agentKeys: [string, ...string[]], tools: ToolRegistry) {
  const AgentKey = z.enum(agentKeys);
  // Runtime value: a project registers its own tools. Unknown names are caught by structural verification.
  const ToolName = tools.names.length > 0 ? z.enum(tools.names as [string, ...string[]]) : z.string();
  const AssertionItem = z.object({
    type: z.enum(["tool", "output", "judge"]),
    agent: AgentKey.nullable().describe("output/judge: the agent whose output is checked. tool: only count calls by this agent, or null for any."),
    tool: ToolName.nullable().describe("tool assertions only; null otherwise."),
    path: z.string().nullable().describe("output/tool assertions: see the vocabulary. null for judge."),
    op: Operator.nullable().describe("output/tool assertions; null for judge."),
    value: z
      .union([z.string(), z.number(), z.boolean()])
      .nullable()
      .describe("Expected value. null when op is exists or is_null, and for judge."),
    match: z.enum(["any", "all"]).nullable().describe("tool assertions on args/result paths; null otherwise."),
    criterion: z.string().nullable().describe("judge only: the plain-language criterion. null otherwise."),
    description: z.string().nullable().describe("Short human-readable label of what the check protects, or null."),
  });
  return z.object({
    representable: z
      .boolean()
      .describe("false if the new requirement can't be expressed with this assertion vocabulary."),
    rationale: z
      .string()
      .describe("1-3 sentences to the owner: what changed in the rule and why, including anything approximated. If not representable, why not."),
    scenario: z
      .object({
        name: z.string(),
        intent: z.string().describe("The requirement in plain language, as the owner would state it."),
        message: z.string().describe("The input message the scenario sends."),
        assertions: z.array(AssertionItem),
      })
      .nullable(),
  });
}

type RawRevision = z.infer<ReturnType<typeof revisionSchema>>;
type RawAssertion = NonNullable<RawRevision["scenario"]>["assertions"][number];

/** Converts one structured item into the domain Assertion, or explains why it isn't a valid check. */
function toAssertion(item: RawAssertion, index: number): Assertion {
  const where = `Assertion ${index + 1}`;
  const description = item.description ?? undefined;
  if (item.type === "judge") {
    if (!item.agent || !item.criterion) throw new ProposalError(`${where}: a judge check needs an agent and a criterion.`);
    return Assertion.parse({ type: "judge", agent: item.agent, criterion: item.criterion, description });
  }
  if (!item.path || !item.op) throw new ProposalError(`${where}: a ${item.type} check needs a path and an operator.`);
  const needsValue = item.op !== "exists" && item.op !== "is_null";
  if (needsValue && item.value === null) throw new ProposalError(`${where}: "${item.op}" needs an expected value.`);
  if ((item.op === "lte" || item.op === "gte") && typeof item.value !== "number") {
    throw new ProposalError(`${where}: "${item.op}" compares numbers, but the expected value is ${JSON.stringify(item.value)}.`);
  }
  const value = needsValue ? item.value : undefined;
  if (item.type === "tool") {
    if (!item.tool) throw new ProposalError(`${where}: a tool check needs a tool.`);
    return Assertion.parse({
      type: "tool",
      tool: item.tool,
      agent: item.agent ?? undefined,
      path: item.path,
      op: item.op,
      value,
      match: item.match ?? "any",
      description,
    });
  }
  if (!item.agent) throw new ProposalError(`${where}: an output check needs an agent.`);
  return Assertion.parse({ type: "output", agent: item.agent, path: item.path, op: item.op, value, description });
}

// ---- Prompt context --------------------------------------------------------------------------------------

const VOCABULARY = `Assertion types:
- output: checks one field of an agent's structured output. Needs agent, path, op, value. path is a dot path into that agent's output fields; numeric segments index arrays (e.g. "alternatives.0").
- tool: checks the calls made to a tool. Needs tool, path, op, value, match. path is "count" (number of calls), "args.<input field>", or "result.<path into the result>". match "any" = at least one call satisfies it; "all" = every call does. agent optionally restricts it to calls by that agent.
- judge: an LLM grades an agent's output against a plain-language criterion. Needs agent and criterion. Judge checks are not deterministic and may be skipped, so the core of the rule must be tool/output checks.

Operators (exact semantics):
- eq / neq: deep equality with value.
- lte / gte: number comparison. Fails when the actual value is not a number, including when it is null or missing.
- contains: case-insensitive substring for strings; element equality for arrays.
- exists: the value is present and not null.
- is_null: the value is missing or null.

There is no if/then, no arithmetic, no cross-field comparison, and no other assertion type or operator.`;

function describeAgents(versions: VersionSet): string {
  return JSON.stringify(
    Object.entries(versions).map(([key, { config }]) => ({
      key,
      name: config.name,
      role: config.role,
      tools: config.tools,
      output_fields: Object.fromEntries(
        Object.entries((config.outputSchema.properties ?? {}) as Record<string, { type?: unknown; items?: { type?: unknown } }>).map(
          ([field, schema]) => [field, schema.items ? { type: schema.type, items: schema.items.type } : schema.type],
        ),
      ),
    })),
    null,
    2,
  );
}

function describeTools(tools: ToolRegistry): string {
  return JSON.stringify(
    tools.names.map((t) => ({
      name: t,
      description: tools.descriptions[t],
      input: tools.inputSchemas[t],
      result: tools.resultShapes[t],
    })),
    null,
    2,
  );
}

function describeScenario(s: CurrentScenario): string {
  return JSON.stringify(
    {
      key: s.key,
      version: s.version,
      name: s.name,
      intent: s.intent,
      input_message: s.input.message,
      assertions: s.assertions.map((a) => ({ ...a, reads_as: describeAssertion(a) })),
    },
    null,
    2,
  );
}

function describeFailure(result: ScenarioResult | undefined): string {
  if (!result) return "(no failure recorded)";
  const checks = result.assertions.map(
    (a) =>
      `- [${a.status}] ${describeAssertion(a.assertion)}` +
      (a.status === "pass" ? "" : ` → got ${a.reason ?? JSON.stringify(a.actual ?? null)}`),
  );
  const outputs = Object.values(result.trace.agents).map((t) => `- ${t.agent}: ${JSON.stringify(t.output)}`);
  return [`Result: ${result.status}`, "Checks:", ...checks, "Agent outputs:", ...outputs].join("\n");
}

// ---- Drafting --------------------------------------------------------------------------------------------

const INSTRUCTIONS = `You are Architect. You maintain Scenarios: executable rules that verify a multi-agent application's behavior.
The owner has changed their mind about one rule. Revise that Scenario so it encodes the owner's new requirement.

Principles:
- Encode the new requirement faithfully. Change only what the new requirement changes and keep every other assertion as it is.
- You are revising the rule, not the agents. Don't try to make any particular agent version pass; the revised rule is verified independently afterwards.
- Use only the assertion vocabulary below, with real agent output fields, tool input fields and tool result fields.
- Keep the input message unless the new requirement is about a different request.
- If the new requirement can't be represented with this vocabulary, set representable to false and scenario to null, and explain why in rationale. If you can only approximate it, do so and say exactly what is approximated.

${VOCABULARY}`;

/**
 * Drafts a revised Scenario from the owner's new requirement. The result is only a draft: it is checked against
 * the domain model and the structural rules here, then stored as a proposed version for the owner to review.
 */
export async function draftScenarioRevision(input: {
  scenario: CurrentScenario;
  request: string;
  versions: VersionSet;
  runtime: ProjectRuntime;
  failure?: ScenarioResult;
  config?: ProposerConfig;
}): Promise<ScenarioDraft> {
  const config = input.config ?? proposerConfig();
  const agentKeys = Object.keys(input.versions) as [string, ...string[]];
  const model = resolveProposerModel(config, () => {
    const fixture = input.runtime.fixtureScenarioProposer;
    if (!fixture) {
      throw new ProposalError(
        "Demo mode can't draft rule changes for this project: it has no recorded offline proposer. Run it in Live mode instead.",
      );
    }
    return fixture();
  });
  const prompt = `<scenario>
${describeScenario(input.scenario)}
</scenario>

<how_it_failed>
${describeFailure(input.failure)}
</how_it_failed>

<agents>
${describeAgents(input.versions)}
</agents>

<tools>
${describeTools(input.runtime.tools)}
</tools>

<new_requirement>
${input.request}
</new_requirement>`;

  let raw: RawRevision;
  try {
    const { output } = await generateText({
      model,
      instructions: INSTRUCTIONS,
      prompt,
      output: Output.object({ schema: revisionSchema(agentKeys, input.runtime.tools) }),
    });
    raw = output;
  } catch (err) {
    throw new ProposalError(`Architect couldn't draft the rule change: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!raw.representable || !raw.scenario) {
    throw new ProposalError(raw.rationale || "This requirement can't be expressed with the existing scenario checks.");
  }
  const assertions = raw.scenario.assertions.map(toAssertion);
  if (!assertions.some((a) => a.type !== "judge")) {
    throw new ProposalError(
      "The proposed rule only had judge checks, which aren't deterministic and may be skipped. A rule needs at least one tool or output check.",
    );
  }
  const content: ScenarioContent = {
    name: raw.scenario.name.trim(),
    intent: raw.scenario.intent.trim(),
    input: { message: raw.scenario.message.trim() },
    assertions,
  };

  const structural = checkStructure(
    input.versions,
    [{ key: input.scenario.key, assertions }],
    input.runtime.tools,
  ).filter((c) => !c.ok);
  if (structural.length) {
    throw new ProposalError(`The proposed rule doesn't fit the current agents: ${structural.map((c) => c.message).join("; ")}`);
  }
  const { name, intent, input: currentInput, assertions: currentAssertions } = input.scenario;
  const current: ScenarioContent = { name, intent, input: currentInput, assertions: currentAssertions };
  // JSON round-trip drops undefined optionals so equal rules compare equal.
  if (isDeepStrictEqual(JSON.parse(JSON.stringify(content)), JSON.parse(JSON.stringify(current)))) {
    throw new ProposalError(raw.rationale || "The proposed rule is identical to the current one.");
  }

  return {
    content,
    proposal: { mode: config.mode, model: config.mode === "fixture" ? "fixture" : config.model, rationale: raw.rationale },
  };
}
