import { isDeepStrictEqual } from "node:util";
import { generateText, Output } from "ai";
import { z } from "zod";
import type { Assertion, AssertionResult, JudgeAssertion, Operator, Trace } from "@/domain/schemas";
import { hasCredentials, judgeModelSpec, resolveModel } from "@/runtime/models";

export type JudgeMode = "skip" | "live";

/** Dot path with numeric array indices, e.g. "items.0.sku". */
export function getPath(value: unknown, path: string): unknown {
  if (path === "") return value;
  return path.split(".").reduce<unknown>((cur, key) => {
    if (cur == null || typeof cur !== "object") return undefined;
    return (cur as Record<string, unknown>)[key];
  }, value);
}

export function applyOperator(op: Operator, actual: unknown, expected: unknown): boolean {
  switch (op) {
    case "eq":
      return isDeepStrictEqual(actual, expected);
    case "neq":
      return !isDeepStrictEqual(actual, expected);
    case "lte":
      return typeof actual === "number" && typeof expected === "number" && actual <= expected;
    case "gte":
      return typeof actual === "number" && typeof expected === "number" && actual >= expected;
    case "contains":
      if (typeof actual === "string") return actual.toLowerCase().includes(String(expected).toLowerCase());
      if (Array.isArray(actual)) return actual.some((v) => isDeepStrictEqual(v, expected));
      return false;
    case "exists":
      return actual !== undefined && actual !== null;
    case "is_null":
      return actual === undefined || actual === null;
  }
}

export { describeAssertion } from "@/domain/format";

function evaluateTool(a: Extract<Assertion, { type: "tool" }>, trace: Trace): AssertionResult {
  const calls = trace.toolCalls.filter((c) => c.tool === a.tool && (!a.agent || c.agent === a.agent));
  if (a.path === "count") {
    const ok = applyOperator(a.op, calls.length, a.value);
    return { assertion: a, status: ok ? "pass" : "fail", actual: calls.length };
  }
  const [source, ...rest] = a.path.split(".");
  if (source !== "args" && source !== "result") {
    return { assertion: a, status: "error", reason: `tool path must be "count", "args.*" or "result.*"` };
  }
  if (calls.length === 0) return { assertion: a, status: "fail", reason: `${a.tool} was never called` };
  const values = calls.map((c) => getPath(source === "args" ? c.args : c.result, rest.join(".")));
  const results = values.map((v) => applyOperator(a.op, v, a.value));
  const ok = a.match === "all" ? results.every(Boolean) : results.some(Boolean);
  return { assertion: a, status: ok ? "pass" : "fail", actual: values.length === 1 ? values[0] : values };
}

function evaluateOutput(a: Extract<Assertion, { type: "output" }>, trace: Trace): AssertionResult {
  const agent = trace.agents[a.agent];
  if (!agent) return { assertion: a, status: "fail", reason: `${a.agent} did not run` };
  const actual = getPath(agent.output, a.path);
  return { assertion: a, status: applyOperator(a.op, actual, a.value) ? "pass" : "fail", actual };
}

const Verdict = z.object({ pass: z.boolean(), reason: z.string() });

async function evaluateJudge(a: JudgeAssertion, trace: Trace, message: string, mode: JudgeMode): Promise<AssertionResult> {
  if (mode === "skip") return { assertion: a, status: "skipped", reason: "judge disabled (pass --judge or --live)" };
  const spec = judgeModelSpec();
  if (!hasCredentials(spec)) return { assertion: a, status: "skipped", reason: `no API key for ${spec}` };
  const agent = trace.agents[a.agent];
  if (!agent) return { assertion: a, status: "fail", reason: `${a.agent} did not run` };
  try {
    const { output } = await generateText({
      model: resolveModel(spec),
      instructions:
        "You are a strict evaluator of a laptop store's AI assistant. Decide whether the agent output satisfies the criterion. Judge only what is written.",
      prompt: `Criterion:\n${a.criterion}\n\nCustomer message:\n${message}\n\nAgent output (${a.agent}):\n${JSON.stringify(agent.output, null, 2)}`,
      output: Output.object({ schema: Verdict }),
    });
    return { assertion: a, status: output.pass ? "pass" : "fail", reason: output.reason };
  } catch (err) {
    return { assertion: a, status: "error", reason: err instanceof Error ? err.message : String(err) };
  }
}

export async function evaluateAssertion(
  a: Assertion,
  trace: Trace,
  message: string,
  judge: JudgeMode,
): Promise<AssertionResult> {
  switch (a.type) {
    case "tool":
      return evaluateTool(a, trace);
    case "output":
      return evaluateOutput(a, trace);
    case "judge":
      return evaluateJudge(a, trace, message, judge);
  }
}
