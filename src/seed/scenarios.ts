import type { Assertion, ScenarioInput } from "@/domain/schemas";

export type SeedScenario = {
  key: string;
  name: string;
  intent: string;
  input: ScenarioInput;
  assertions: Assertion[];
};

export const seedScenarios: SeedScenario[] = [
  {
    key: "student-within-budget",
    name: "Finds a light laptop within budget",
    intent: "Students on a budget get a portable laptop they can actually afford.",
    input: {
      message:
        "I'm a student. I mostly write papers and browse. My budget is under $700 and it needs to be light enough to carry all day.",
    },
    assertions: [
      { type: "output", agent: "needs-analyst", path: "budget_usd", op: "eq", value: 700 },
      { type: "tool", tool: "search_catalog", path: "count", op: "gte", value: 1, match: "any" },
      { type: "tool", tool: "search_catalog", path: "args.max_price_usd", op: "lte", value: 700, match: "any" },
      { type: "tool", tool: "search_catalog", path: "args.needs_dedicated_gpu", op: "neq", value: true, match: "all" },
      { type: "output", agent: "recommendation-agent", path: "recommended_sku", op: "exists" },
      { type: "output", agent: "recommendation-agent", path: "recommended_price_usd", op: "lte", value: 700 },
      {
        type: "judge",
        agent: "store-advisor",
        criterion: "The reply recommends one laptop and explains why it suits a student who needs portability on a budget.",
      },
    ],
  },
  {
    key: "no-match-honesty",
    name: "Says so when nothing matches",
    intent: "Never tell a customer a laptop meets their needs when it doesn't. Honesty beats a sale.",
    input: { message: "I want a gaming laptop with an RTX graphics card for under $600." },
    assertions: [
      { type: "output", agent: "needs-analyst", path: "needs_dedicated_gpu", op: "eq", value: true },
      { type: "tool", tool: "search_catalog", path: "count", op: "gte", value: 1, match: "any" },
      {
        type: "output",
        agent: "recommendation-agent",
        path: "recommended_sku",
        op: "is_null",
        description: "No laptop is presented as a match",
      },
      { type: "output", agent: "recommendation-agent", path: "meets_all_requirements", op: "eq", value: false },
      {
        type: "output",
        agent: "recommendation-agent",
        path: "alternatives.0",
        op: "exists",
        description: "Offers the closest alternative instead of a dead end",
      },
      {
        type: "judge",
        agent: "store-advisor",
        criterion:
          "The reply tells the customer plainly that no laptop meets all of their requirements, and does not claim that any laptop does.",
      },
    ],
  },
  {
    key: "video-editor-gpu",
    name: "Video editor gets a dedicated GPU and enough RAM",
    intent: "Professional workloads get hardware that meets their stated minimums.",
    input: { message: "I edit 4K video for clients. Budget is up to $2,200 and I need at least 32GB of RAM." },
    assertions: [
      { type: "output", agent: "needs-analyst", path: "use_case", op: "contains", value: "video" },
      { type: "output", agent: "needs-analyst", path: "min_ram_gb", op: "eq", value: 32 },
      { type: "tool", tool: "search_catalog", path: "args.min_ram_gb", op: "gte", value: 32, match: "any" },
      { type: "tool", tool: "search_catalog", path: "result.items.0.dedicated_gpu", op: "eq", value: true, match: "any" },
      { type: "output", agent: "recommendation-agent", path: "meets_all_requirements", op: "eq", value: true },
      { type: "output", agent: "recommendation-agent", path: "recommended_price_usd", op: "lte", value: 2200 },
    ],
  },
];
