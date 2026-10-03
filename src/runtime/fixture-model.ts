import { MockLanguageModelV4 } from "ai/test";
import { parseAgentPrompt } from "./prompt";

/**
 * Generic plumbing for Architect's deterministic model mode ("Demo mode").
 *
 * This module knows nothing about any application domain. It turns a project's simulator — a policy per agent —
 * into an AI SDK language model, so the same agent runtime, tool calls and assertions execute offline and
 * reproducibly. The policies themselves belong to the project (see src/demo/simulator.ts for Laptop Advisor).
 */

/** What a policy gets to see: the agent's instructions, the scenario input, prior agents' outputs, tool results. */
export type PolicyContext = {
  instructions: string;
  message: string;
  context: Record<string, any>;
  toolResults: unknown[];
};

/** One turn: call a tool, or return the agent's structured output. */
export type SimulatorStep = { toolCall: { toolName: string; input: unknown } } | { output: unknown };

export type SimulatorPolicy = (ctx: PolicyContext) => SimulatorStep;

/** A project's deterministic stand-in behavior, looked up per agent key. */
export type SimulatorProvider = {
  /** A label for the simulator, used in messages. */
  name: string;
  policyFor(agentKey: string): SimulatorPolicy | undefined;
};

/**
 * Demo mode was requested for something it can't reproduce. Surfaced to the user as a configuration limit,
 * never papered over: a project without a simulator has no deterministic behavior to run, and inventing one
 * would make a scenario's verdict meaningless.
 */
export class FixtureModeError extends Error {}

/** Builds a SimulatorProvider from a plain map of agent key to policy. */
export function simulatorFromPolicies(name: string, policies: Record<string, SimulatorPolicy>): SimulatorProvider {
  return { name, policyFor: (agentKey) => policies[agentKey] };
}

const usage = {
  inputTokens: { total: 0, noCache: 0, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 0, text: 0, reasoning: undefined },
};

type CallOptions = Parameters<MockLanguageModelV4["doGenerate"]>[0];

/**
 * The deterministic model for one agent, backed by the project's simulator. Without a simulator — or without a
 * policy for this agent — Demo mode fails with a message meant for the user instead of faking an answer.
 */
export function createFixtureModel(agentKey: string, simulator: SimulatorProvider | undefined) {
  if (!simulator) {
    throw new FixtureModeError(
      "Demo mode isn't available for this project: it has no deterministic simulator for its agents. Run it in Live mode instead.",
    );
  }
  const policy = simulator.policyFor(agentKey);
  if (!policy) {
    throw new FixtureModeError(
      `Demo mode can't run the agent "${agentKey}": this project's simulator defines no behavior for it. Run it in Live mode instead.`,
    );
  }
  let callIds = 0;
  return new MockLanguageModelV4({
    provider: "fixture",
    modelId: agentKey,
    doGenerate: async (options: CallOptions) => {
      const instructions = options.prompt.flatMap((m) => (m.role === "system" ? [m.content] : [])).join("\n");
      const userText = options.prompt
        .flatMap((m) => (m.role === "user" ? m.content : []))
        .flatMap((p) => (p.type === "text" ? [p.text] : []))
        .join("\n");
      const toolResults: unknown[] = [];
      for (const m of options.prompt) {
        if (m.role !== "tool" && m.role !== "assistant") continue;
        for (const p of m.content) {
          if (p.type === "tool-result" && p.output.type === "json") toolResults.push(p.output.value);
        }
      }

      const { message, context } = parseAgentPrompt(userText);
      const step = policy({ instructions, message, context, toolResults });

      if ("toolCall" in step) {
        return {
          content: [
            {
              type: "tool-call" as const,
              toolCallId: `fixture-${agentKey}-${++callIds}`,
              toolName: step.toolCall.toolName,
              input: JSON.stringify(step.toolCall.input),
            },
          ],
          finishReason: { unified: "tool-calls" as const, raw: undefined },
          usage,
          warnings: [],
        };
      }
      return {
        content: [{ type: "text" as const, text: JSON.stringify(step.output) }],
        finishReason: { unified: "stop" as const, raw: undefined },
        usage,
        warnings: [],
      };
    },
  });
}
