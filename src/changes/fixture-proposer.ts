import { MockLanguageModelV4 } from "ai/test";
import { fixEdits } from "@/fixtures/fix";
import { REGRESSION_INTENT, regressionEdits } from "@/fixtures/regression";
import type { AgentEdit } from "./change";

/**
 * Deterministic stand-in for the proposer LLM (ARCHITECT_PROPOSER=fixture). It answers through the same
 * structured-output contract as a real model, but only knows the scripted demo request: it replays the
 * recorded regression edits for the draft and the recorded fix for "Keep the rule → Fix it".
 */

export const FIXTURE_INTENTS = [REGRESSION_INTENT];

const known = [
  {
    intent: REGRESSION_INTENT,
    draft: {
      edits: regressionEdits,
      rationale:
        "Rewrote the Recommendation Agent's rules and tone so it always closes with a confident recommendation instead of telling customers no.",
    },
    fix: {
      edits: fixEdits,
      rationale:
        "Kept the confident, persuasive tone but restored the honesty rule: when nothing meets every requirement, it says so plainly and confidently pitches the closest alternative instead.",
    },
  },
];

const normalize = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const tagged = (text: string, tag: string) => text.match(new RegExp(`<${tag}>\\n?([\\s\\S]*?)\\n?</${tag}>`))?.[1] ?? "";

function toRaw(edits: Record<string, AgentEdit>) {
  return Object.entries(edits).map(([agent, e]) => ({
    agent,
    instructions: e.instructions ?? null,
    role: e.role ?? null,
    tools: e.tools ?? null,
    handoffs: e.handoffs ?? null,
  }));
}

type CallOptions = Parameters<MockLanguageModelV4["doGenerate"]>[0];

export function createFixtureProposerModel(kind: "draft" | "fix") {
  return new MockLanguageModelV4({
    provider: "fixture",
    modelId: `proposer-${kind}`,
    doGenerate: async (options: CallOptions) => {
      const prompt = options.prompt
        .flatMap((m) => (m.role === "user" ? m.content : []))
        .flatMap((p) => (p.type === "text" ? [p.text] : []))
        .join("\n");
      const intent = tagged(prompt, kind === "draft" ? "request" : "original_request");
      const match = known.find((k) => normalize(k.intent) === normalize(intent));
      const answer = match
        ? { rationale: match[kind].rationale, edits: toRaw(match[kind].edits) }
        : {
            rationale:
              "The offline fixture proposer only knows the scripted demo request. Set ANTHROPIC_API_KEY (or ARCHITECT_PROPOSER=live) to draft other changes.",
            edits: [],
          };
      return {
        content: [{ type: "text" as const, text: JSON.stringify(answer) }],
        finishReason: { unified: "stop" as const, raw: undefined },
        usage: {
          inputTokens: { total: 0, noCache: 0, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 0, text: 0, reasoning: undefined },
        },
        warnings: [],
      };
    },
  });
}
