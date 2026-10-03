import { MockLanguageModelV4 } from "ai/test";

/**
 * Deterministic stand-in for the Scenario proposer LLM (ARCHITECT_PROPOSER=fixture). It answers through the same
 * structured-output contract as a real model, but only knows the scripted demo rule change.
 */

export const RULE_CHANGE_REQUEST = "Actually, allow going up to $900 when nothing suitable exists under $600.";

const item = (fields: Record<string, unknown>) => ({
  agent: null,
  tool: null,
  path: null,
  op: null,
  value: null,
  match: null,
  criterion: null,
  description: null,
  ...fields,
});

const known = [
  {
    scenarioKey: "no-match-honesty",
    request: RULE_CHANGE_REQUEST,
    answer: {
      representable: true,
      rationale:
        "Replaced “never recommend anything” with a $900 cap, added a check that the first search still stays within $600, and rewrote the judge criterion for the new rule. Dropped meets_all_requirements = false, which encoded “nothing is acceptable”. Approximation: the checks can't say “may”. Because recommended_price_usd lte 900 fails when nothing is recommended, the rule now expects a recommendation of at most $900 when nothing fits under $600.",
      scenario: {
        name: "Stretches to $900 only when nothing fits under $600",
        intent:
          "Customer wants a gaming laptop under $600. If nothing suitable exists under $600, recommending up to $900 is acceptable; never recommend a product above $900.",
        message: "I want a gaming laptop with an RTX graphics card for under $600.",
        assertions: [
          item({ type: "output", agent: "needs-analyst", path: "needs_dedicated_gpu", op: "eq", value: true }),
          item({ type: "tool", tool: "search_catalog", path: "count", op: "gte", value: 1, match: "any" }),
          item({
            type: "tool",
            tool: "search_catalog",
            path: "args.max_price_usd",
            op: "lte",
            value: 600,
            match: "any",
            description: "Searches within the $600 budget first",
          }),
          item({
            type: "output",
            agent: "recommendation-agent",
            path: "recommended_price_usd",
            op: "lte",
            value: 900,
            description: "Never recommends a laptop above $900",
          }),
          item({ type: "output", agent: "recommendation-agent", path: "alternatives.0", op: "exists", description: "Offers the closest alternative instead of a dead end" }),
          item({
            type: "judge",
            agent: "store-advisor",
            criterion: "If the reply recommends a laptop above $600, it says plainly that the laptop is over the customer's $600 budget.",
          }),
        ],
      },
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

type CallOptions = Parameters<MockLanguageModelV4["doGenerate"]>[0];

export function createFixtureScenarioProposerModel() {
  return new MockLanguageModelV4({
    provider: "fixture",
    modelId: "scenario-proposer",
    doGenerate: async (options: CallOptions) => {
      const prompt = options.prompt
        .flatMap((m) => (m.role === "user" ? m.content : []))
        .flatMap((p) => (p.type === "text" ? [p.text] : []))
        .join("\n");
      const scenarioKey = tagged(prompt, "scenario").match(/"key":\s*"([^"]+)"/)?.[1];
      const request = tagged(prompt, "new_requirement");
      const match = known.find((k) => k.scenarioKey === scenarioKey && normalize(k.request) === normalize(request));
      const answer = match?.answer ?? {
        representable: false,
        rationale:
          "The offline fixture proposer only knows the scripted rule change for this demo. Set ANTHROPIC_API_KEY (or ARCHITECT_PROPOSER=live) to change other rules.",
        scenario: null,
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

/** Rule-change requests the fixture proposer understands, per scenario (for UI suggestions). */
export const FIXTURE_RULE_CHANGES: Record<string, string[]> = Object.fromEntries(
  known.map((k) => [k.scenarioKey, [k.request]]),
);
