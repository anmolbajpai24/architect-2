import { z } from "zod";

/** JSON Schema object describing an agent's structured output. Kept as data so AgentVersions are self-contained. */
export const JsonSchemaObject = z
  .object({ type: z.literal("object"), properties: z.record(z.string(), z.any()) })
  .passthrough();

export const AgentConfig = z.object({
  name: z.string().min(1),
  role: z.string().min(1),
  /** "<provider>:<model id>", e.g. "anthropic:claude-opus-5-5". */
  model: z.string().regex(/^(anthropic|openai):.+$/, "model must be '<anthropic|openai>:<model id>'"),
  instructions: z.string().min(1),
  tools: z.array(z.string()),
  /** Agent keys this agent hands off to, run in order before it composes its own output. */
  handoffs: z.array(z.string()),
  outputSchema: JsonSchemaObject,
});
export type AgentConfig = z.infer<typeof AgentConfig>;

export const Operator = z.enum(["eq", "neq", "lte", "gte", "contains", "exists", "is_null"]);
export type Operator = z.infer<typeof Operator>;

const base = { description: z.string().optional() };

export const ToolAssertion = z.object({
  ...base,
  type: z.literal("tool"),
  tool: z.string(),
  /** Restrict to calls made by this agent. */
  agent: z.string().optional(),
  /** "count", "args.<path>" or "result.<path>". */
  path: z.string(),
  op: Operator,
  value: z.unknown().optional(),
  /** For args/result paths: whether any call or every call must satisfy the operator. */
  match: z.enum(["any", "all"]).default("any"),
});

export const OutputAssertion = z.object({
  ...base,
  type: z.literal("output"),
  agent: z.string(),
  path: z.string(),
  op: Operator,
  value: z.unknown().optional(),
});

export const JudgeAssertion = z.object({
  ...base,
  type: z.literal("judge"),
  agent: z.string(),
  criterion: z.string().min(1),
});

export const Assertion = z.discriminatedUnion("type", [ToolAssertion, OutputAssertion, JudgeAssertion]);
export type Assertion = z.infer<typeof Assertion>;
export type ToolAssertion = z.infer<typeof ToolAssertion>;
export type OutputAssertion = z.infer<typeof OutputAssertion>;
export type JudgeAssertion = z.infer<typeof JudgeAssertion>;

export const ScenarioInput = z.object({ message: z.string().min(1) });
export type ScenarioInput = z.infer<typeof ScenarioInput>;

export type AssertionStatus = "pass" | "fail" | "skipped" | "error";

export type AssertionResult = {
  assertion: Assertion;
  status: AssertionStatus;
  actual?: unknown;
  reason?: string;
};

export type ScenarioResult = {
  scenarioId: string;
  scenarioKey: string;
  name: string;
  status: "pass" | "fail" | "error";
  assertions: AssertionResult[];
  trace: Trace;
};

export type ToolCallRecord = { agent: string; tool: string; args: unknown; result: unknown };

export type AgentTrace = {
  agent: string;
  versionId: string;
  output: unknown;
  toolCalls: ToolCallRecord[];
};

export type Trace = {
  agents: Record<string, AgentTrace>;
  toolCalls: ToolCallRecord[];
  error?: string;
};

/** The set of agent versions a run executes: agentKey -> version. */
export type VersionSet = Record<string, { versionId: string; config: AgentConfig }>;
