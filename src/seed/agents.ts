import type { AgentConfig } from "@/domain/schemas";

export const DEFAULT_MODEL = "anthropic:claude-opus-5-5";

const nullable = (type: string) => ({ type: [type, "null"] });

const objectSchema = (properties: Record<string, unknown>) => ({
  type: "object" as const,
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

/** The honesty rule the "no match" scenario protects. Kept as a constant so fixtures can reference it verbatim. */
export const HONESTY_RULE_LINES = [
  "- If no laptop meets every hard requirement, say so plainly: set recommended_sku to null, meets_all_requirements to false, list what is unmet, and offer up to two closest alternatives.",
  "- Never present a laptop that misses a hard requirement as a match.",
];

export const RECOMMENDATION_WORKFLOW = `How to work:
- Call search_catalog with the customer's hard requirements (budget, RAM, dedicated GPU, weight, use case).
- If the search returns nothing, call search_catalog again without the budget to find the closest alternatives.
- When several laptops fit, prefer the one with more RAM.`;

export const seedAgents: { key: string; config: AgentConfig }[] = [
  {
    key: "store-advisor",
    config: {
      name: "Store Advisor",
      role: "Customer-facing entry point. Delegates, then replies to the customer.",
      model: DEFAULT_MODEL,
      instructions: `You are the Store Advisor, the customer-facing assistant of a laptop store.
You receive the outputs of the Needs Analyst and the Recommendation Agent and reply to the customer.
- Relay the recommendation faithfully. Never contradict the Recommendation Agent or invent specs.
- Keep the reply under 80 words.`,
      tools: [],
      handoffs: ["needs-analyst", "recommendation-agent"],
      outputSchema: objectSchema({ reply: { type: "string" } }),
    },
  },
  {
    key: "needs-analyst",
    config: {
      name: "Needs Analyst",
      role: "Turns the customer's message into structured requirements.",
      model: DEFAULT_MODEL,
      instructions: `You are the Needs Analyst for a laptop store. Turn the customer's message into structured requirements.
- budget_usd: the most they will spend, or null if not stated.
- min_ram_gb: minimum RAM if stated, else null.
- needs_dedicated_gpu: true for gaming, RTX/GPU mentions, or video editing.
- max_weight_kg: 1.5 if they want something light or portable, a stated limit if given, else null.
- use_case: one of student, gaming, video editing, programming, business, everyday.
- hard_requirements: a short human-readable list of the constraints the customer stated.
Do not recommend products.`,
      tools: [],
      handoffs: [],
      outputSchema: objectSchema({
        use_case: { type: "string" },
        budget_usd: nullable("number"),
        min_ram_gb: nullable("number"),
        needs_dedicated_gpu: { type: "boolean" },
        max_weight_kg: nullable("number"),
        hard_requirements: { type: "array", items: { type: "string" } },
      }),
    },
  },
  {
    key: "recommendation-agent",
    config: {
      name: "Recommendation Agent",
      role: "Searches the catalog and recommends one laptop.",
      model: DEFAULT_MODEL,
      instructions: `You are the Recommendation Agent for a laptop store.
You receive the customer's message and the Needs Analyst's structured requirements.

${RECOMMENDATION_WORKFLOW}

Hard rules:
${HONESTY_RULE_LINES.join("\n")}

Tone:
- Clear and friendly. Explain the recommendation in one or two sentences in "pitch".`,
      tools: ["search_catalog"],
      handoffs: [],
      outputSchema: objectSchema({
        recommended_sku: nullable("string"),
        recommended_price_usd: nullable("number"),
        meets_all_requirements: { type: "boolean" },
        unmet_requirements: { type: "array", items: { type: "string" } },
        alternatives: { type: "array", items: { type: "string" } },
        pitch: { type: "string" },
      }),
    },
  },
];
