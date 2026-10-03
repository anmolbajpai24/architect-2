import { generateText, Output, type LanguageModel } from "ai";
import { z } from "zod";
import type { ChangeProposal } from "@/db/schema";
import { describeAssertion } from "@/domain/format";
import type { Assertion, ScenarioResult, VersionSet } from "@/domain/schemas";
import { hasCredentials, resolveModel } from "@/runtime/models";
import { entryAgentKey } from "@/runtime/run-system";
import { TOOL_DESCRIPTIONS, TOOL_NAMES } from "@/runtime/tools";
import type { AgentEdit } from "./change";
import { createFixtureProposerModel, FIXTURE_INTENTS } from "./fixture-proposer";

/**
 * Architect's proposer: turns a user's request into edits to agent configurations, using an LLM with
 * structured output. Its edits go through the same pipeline as any other Change (structural check, then
 * every scenario), so the proposer is never trusted on its own.
 *
 * live:    the model in ARCHITECT_PROPOSER_MODEL (default anthropic:claude-opus-5-5).
 * fixture: a deterministic stand-in model that only knows the scripted demo request (offline demo, tests).
 * ARCHITECT_PROPOSER=live|fixture picks one; unset means live when the model's API key is present.
 */

export type ProposerMode = "fixture" | "live";
export type ProposerConfig = { mode: ProposerMode; model: string };
export type Draft = { edits: Record<string, AgentEdit>; proposal: ChangeProposal };

/** A draft that can't become a Change; the message is meant for the user. */
export class ProposalError extends Error {}

export function proposerConfig(): ProposerConfig {
  const model = process.env.ARCHITECT_PROPOSER_MODEL || "anthropic:claude-opus-5-5";
  const explicit = process.env.ARCHITECT_PROPOSER;
  const mode = explicit === "live" || explicit === "fixture" ? explicit : hasCredentials(model) ? "live" : "fixture";
  return { mode, model };
}

export function suggestedIntents(mode: ProposerMode): string[] {
  return mode === "fixture"
    ? FIXTURE_INTENTS
    : [
        ...FIXTURE_INTENTS,
        "Keep the Store Advisor's replies under 40 words.",
        "Have the Needs Analyst treat “light” as 1.3 kg or less.",
      ];
}

// ---- Output contract -------------------------------------------------------------------------------------

function proposalSchema(agentKeys: [string, ...string[]]) {
  const AgentKey = z.enum(agentKeys);
  return z.object({
    rationale: z
      .string()
      .describe("One or two sentences to the user: what you changed and why. If you made no edits, why not."),
    edits: z.array(
      z.object({
        agent: AgentKey,
        instructions: z
          .string()
          .nullable()
          .describe("The agent's complete new instructions (they replace the old ones entirely), or null to keep them."),
        role: z.string().nullable().describe("New one-line role description, or null to keep it."),
        tools: z.array(z.enum(TOOL_NAMES)).nullable().describe("Complete new tool list, or null to keep it."),
        handoffs: z
          .array(AgentKey)
          .nullable()
          .describe("Complete new ordered handoff list, or null to keep it."),
      }),
    ),
  });
}

type RawProposal = z.infer<ReturnType<typeof proposalSchema>>;

/** Nulls mean "keep"; fields equal to the current value are dropped; agents left with nothing are dropped. */
function toEdits(raw: RawProposal, versions: VersionSet): Record<string, AgentEdit> {
  const edits: Record<string, AgentEdit> = {};
  for (const e of raw.edits) {
    const current = versions[e.agent].config;
    const edit: AgentEdit = { ...edits[e.agent] };
    if (e.instructions !== null && e.instructions.trim() !== current.instructions.trim()) edit.instructions = e.instructions;
    if (e.role !== null && e.role !== current.role) edit.role = e.role;
    if (e.tools !== null && e.tools.join() !== current.tools.join()) edit.tools = e.tools;
    if (e.handoffs !== null && e.handoffs.join() !== current.handoffs.join()) edit.handoffs = e.handoffs;
    if (Object.keys(edit).length > 0) edits[e.agent] = edit;
  }
  return edits;
}

// ---- Prompt context --------------------------------------------------------------------------------------

function outputFields(schema: Record<string, unknown>): string[] {
  const properties = Object.keys((schema.properties ?? {}) as object);
  const required = (schema.required as string[] | undefined) ?? [];
  return [...required.filter((k) => properties.includes(k)), ...properties.filter((k) => !required.includes(k))];
}

function describeAgents(versions: VersionSet, keys = Object.keys(versions)): string {
  return JSON.stringify(
    keys.map((key) => {
      const c = versions[key].config;
      return {
        key,
        name: c.name,
        role: c.role,
        tools: c.tools,
        handoffs: c.handoffs,
        output_fields: outputFields(c.outputSchema),
        instructions: c.instructions,
      };
    }),
    null,
    2,
  );
}

function describeTools(): string {
  return TOOL_NAMES.map((t) => `- ${t}: ${TOOL_DESCRIPTIONS[t]}`).join("\n");
}

const RULES = `Rules:
- Edit only the agents the request concerns. In each edit, set only the fields you change and use null for the rest.
- "instructions" replaces the agent's instructions entirely, so return the complete new text. Keep the existing structure and wording wherever the request doesn't call for a change.
- Each agent returns structured output with fixed fields (output_fields). You can't add or remove fields, so instructions must keep using the existing field names.
- Tools must come from the available tools. Handoffs must name existing agents, run in the listed order, and must not form a cycle.
- If the request is unclear, already satisfied, or can't be done by editing these fields, return no edits and explain why in "rationale".`;

// ---- Calling the model -----------------------------------------------------------------------------------

/** The model a proposer calls: the fixture stand-in, or the configured provider model if its key is present. */
export function resolveProposerModel(config: ProposerConfig, fixture: () => LanguageModel): LanguageModel {
  if (config.mode === "fixture") return fixture();
  if (!hasCredentials(config.model)) {
    const provider = config.model.split(":")[0];
    throw new ProposalError(
      `No API key for ${provider}. Set ${provider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY"}, or ARCHITECT_PROPOSER=fixture for the offline demo.`,
    );
  }
  return resolveModel(config.model);
}

async function propose(
  kind: "draft" | "fix",
  config: ProposerConfig,
  versions: VersionSet,
  instructions: string,
  prompt: string,
): Promise<Draft> {
  const agentKeys = Object.keys(versions) as [string, ...string[]];
  const model = resolveProposerModel(config, () => createFixtureProposerModel(kind));

  let raw: RawProposal;
  try {
    const { output } = await generateText({
      model,
      instructions,
      prompt,
      output: Output.object({ schema: proposalSchema(agentKeys) }),
    });
    raw = output;
  } catch (err) {
    throw new ProposalError(`Architect couldn't draft the change: ${err instanceof Error ? err.message : String(err)}`);
  }

  const edits = toEdits(raw, versions);
  if (Object.keys(edits).length === 0) {
    throw new ProposalError(raw.rationale || "Architect didn't find anything to change for this request.");
  }
  return {
    edits,
    proposal: { mode: config.mode, model: config.mode === "fixture" ? "fixture" : config.model, rationale: raw.rationale },
  };
}

/** Drafts edits for a new request. The proposer sees the live configuration, not the scenarios: those verify it. */
export async function draftChange(input: { intent: string; versions: VersionSet; config?: ProposerConfig }): Promise<Draft> {
  const instructions = `You are Architect. You change the configuration of a multi-agent application so it does what its owner asks.
You get the current configuration of every agent, the tools available, and the owner's request. Respond with the smallest set of edits that carries out the request.

${RULES}`;
  const prompt = `<agents>
${describeAgents(input.versions)}
</agents>

<available_tools>
${describeTools()}
</available_tools>

<request>
${input.intent}
</request>`;
  return propose("draft", input.config ?? proposerConfig(), input.versions, instructions, prompt);
}

/**
 * "Keep the rule → Fix it": revises a blocked change. The proposer sees the live and blocked configurations,
 * every behavior the owner protects, and exactly how the blocked change failed. Edits apply to the live versions.
 */
export async function draftFix(input: {
  intent: string;
  live: VersionSet;
  blocked: VersionSet;
  editedAgents: string[];
  scenarios: { key: string; name: string; intent: string; input: { message: string }; assertions: Assertion[] }[];
  results: ScenarioResult[];
  config?: ProposerConfig;
}): Promise<Draft> {
  const entry = entryAgentKey(input.live);
  const failures = input.results
    .filter((r) => r.status !== "pass")
    .map((r) => {
      const scenario = input.scenarios.find((s) => s.key === r.scenarioKey);
      const failed = r.assertions
        .filter((a) => a.status === "fail" || a.status === "error")
        .map((a) => `  - expected ${describeAssertion(a.assertion)}; got ${a.reason ?? JSON.stringify(a.actual ?? null)}`);
      const finalOutput = r.trace.agents[entry]?.output;
      return [
        `Scenario "${r.name}" protects: ${scenario?.intent ?? "(unknown)"}`,
        `  Customer message: ${scenario?.input.message ?? "(unknown)"}`,
        ...failed,
        `  Final output of ${entry}: ${JSON.stringify(finalOutput ?? null)}`,
      ].join("\n");
    })
    .join("\n\n");

  const instructions = `You are Architect. You change the configuration of a multi-agent application so it does what its owner asks.
A change you drafted was blocked: it broke a behavior the owner protects with a scenario. The owner chose to keep that rule and asked you to fix the change.
Revise the change so it carries out the original request as far as possible without breaking any protected behavior. Your edits apply to the live configuration, not to the blocked one.

${RULES}`;
  const prompt = `<live_agents>
${describeAgents(input.live)}
</live_agents>

<blocked_change>
${describeAgents(input.blocked, input.editedAgents)}
</blocked_change>

<protected_behaviors>
${input.scenarios.map((s) => `- ${s.name}: ${s.intent}`).join("\n")}
</protected_behaviors>

<why_it_was_blocked>
${failures || "(no failure details recorded)"}
</why_it_was_blocked>

<available_tools>
${describeTools()}
</available_tools>

<original_request>
${input.intent}
</original_request>`;
  return propose("fix", input.config ?? proposerConfig(), input.live, instructions, prompt);
}
