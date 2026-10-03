import { generateText, isStepCount, jsonSchema, Output } from "ai";
import type { Db } from "@/db/client";
import type { AgentTrace, Trace, VersionSet } from "@/domain/schemas";
import { agentModel, type ModelMode } from "./models";
import { buildAgentPrompt } from "./prompt";
import { buildTools } from "./tools";

/** The entry agent is the one no other agent hands off to. Structural verification guarantees exactly one. */
export function entryAgentKey(versions: VersionSet): string {
  const targets = new Set(Object.values(versions).flatMap((v) => v.config.handoffs));
  const roots = Object.keys(versions).filter((k) => !targets.has(k));
  if (roots.length !== 1) throw new Error(`Expected exactly one entry agent, found: ${roots.join(", ") || "none"}`);
  return roots[0];
}

async function runAgent(
  db: Db,
  key: string,
  versions: VersionSet,
  message: string,
  context: Record<string, unknown>,
  mode: ModelMode,
): Promise<AgentTrace> {
  const { versionId, config } = versions[key];
  const result = await generateText({
    model: agentModel(key, config.model, mode),
    instructions: config.instructions,
    prompt: buildAgentPrompt(message, context),
    tools: config.tools.length > 0 ? buildTools(db, config.tools) : undefined,
    output: Output.object({ schema: jsonSchema<Record<string, unknown>>(config.outputSchema as any) }),
    stopWhen: isStepCount(6),
  });
  return {
    agent: key,
    versionId,
    output: result.output,
    toolCalls: result.steps
      .flatMap((s) => s.toolResults)
      .map((r) => ({ agent: key, tool: r.toolName, args: r.input, result: r.output })),
  };
}

/**
 * Runs the agent system for one customer message: the entry agent's handoffs run in order, each seeing the
 * outputs before it, then the entry agent composes the final output.
 */
export async function runSystem(db: Db, versions: VersionSet, message: string, mode: ModelMode): Promise<Trace> {
  const trace: Trace = { agents: {}, toolCalls: [] };
  try {
    const entry = entryAgentKey(versions);
    const context: Record<string, unknown> = {};
    for (const key of [...versions[entry].config.handoffs, entry]) {
      const agentTrace = await runAgent(db, key, versions, message, context, mode);
      trace.agents[key] = agentTrace;
      trace.toolCalls.push(...agentTrace.toolCalls);
      context[key] = agentTrace.output;
    }
  } catch (err) {
    trace.error = err instanceof Error ? err.message : String(err);
  }
  return trace;
}
