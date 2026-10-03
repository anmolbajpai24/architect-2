import { generateText, isStepCount, jsonSchema, Output } from "ai";
import type { Db } from "@/db/client";
import type { AgentTrace, Trace, VersionSet } from "@/domain/schemas";
import type { ProjectRuntime } from "@/projects/types";
import { agentModel, type ModelMode } from "./models";
import { buildAgentPrompt } from "./prompt";

/** The entry agent is the one no other agent hands off to. Structural verification guarantees exactly one. */
export function entryAgentKey(versions: VersionSet): string {
  const targets = new Set(Object.values(versions).flatMap((v) => v.config.handoffs));
  const roots = Object.keys(versions).filter((k) => !targets.has(k));
  if (roots.length !== 1) throw new Error(`Expected exactly one entry agent, found: ${roots.join(", ") || "none"}`);
  return roots[0];
}

/** One execution of a project's agent system: which agents, on which models, with which project's tools. */
export type RunSystemOptions = {
  projectId: string;
  versions: VersionSet;
  message: string;
  mode: ModelMode;
  /** The project being run: supplies the tool registry and, in fixture mode, the simulator. */
  runtime: ProjectRuntime;
};

async function runAgent(db: Db, key: string, opts: RunSystemOptions, context: Record<string, unknown>): Promise<AgentTrace> {
  const { versionId, config } = opts.versions[key];
  const result = await generateText({
    model: agentModel(key, config.model, opts.mode, opts.runtime.simulator),
    instructions: config.instructions,
    prompt: buildAgentPrompt(opts.message, context),
    tools:
      config.tools.length > 0
        ? opts.runtime.tools.build({ db, projectId: opts.projectId }, config.tools)
        : undefined,
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
 * Runs the agent system for one input message: the entry agent's handoffs run in order, each seeing the
 * outputs before it, then the entry agent composes the final output.
 */
export async function runSystem(db: Db, opts: RunSystemOptions): Promise<Trace> {
  const trace: Trace = { agents: {}, toolCalls: [] };
  try {
    const entry = entryAgentKey(opts.versions);
    const context: Record<string, unknown> = {};
    for (const key of [...opts.versions[entry].config.handoffs, entry]) {
      const agentTrace = await runAgent(db, key, opts, context);
      trace.agents[key] = agentTrace;
      trace.toolCalls.push(...agentTrace.toolCalls);
      context[key] = agentTrace.output;
    }
  } catch (err) {
    trace.error = err instanceof Error ? err.message : String(err);
  }
  return trace;
}
