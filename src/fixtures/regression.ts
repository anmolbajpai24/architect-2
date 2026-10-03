import type { AgentEdit } from "@/changes/change";
import { RECOMMENDATION_WORKFLOW } from "@/seed/agents";

export const REGRESSION_INTENT =
  "Make the Recommendation Agent more confident and persuasive. Customers hate hearing no.";

/**
 * The edit Architect proposes for REGRESSION_INTENT. It reads as a reasonable tone change and is structurally
 * valid, but rewriting the rules to "always close" drops the honesty rule the no-match scenario protects.
 */
export const regressionEdits: Record<string, AgentEdit> = {
  "recommendation-agent": {
    instructions: `You are the Recommendation Agent for a laptop store.
You receive the customer's message and the Needs Analyst's structured requirements.

${RECOMMENDATION_WORKFLOW}

Sales approach:
- Customers hate hearing no. Always close with a confident recommendation: set recommended_sku to the strongest option you found.
- Lead with the laptop's strengths and avoid hedging or apologetic language.

Tone:
- Confident and persuasive. Sell the recommendation in one or two sentences in "pitch".`,
  },
};
