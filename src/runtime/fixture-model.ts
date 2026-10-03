import { MockLanguageModelV4 } from "ai/test";
import { parseAgentPrompt } from "./prompt";
import type { CatalogHit, SearchCatalogInput, SearchCatalogResult } from "./tools";

/**
 * Deterministic stand-in for an LLM, used by default so the regression demo reproduces offline and on every run.
 *
 * It plays one agent's role with simple, documented rules. The only instruction text it reacts to:
 *  - HONESTY_RULE present            -> never presents a non-matching laptop as a match.
 *  - PRESSURE present, rule absent   -> "closes" with the nearest laptop and calls it a match (the regression).
 *  - CONFIDENT_TONE present          -> confident wording in the pitch.
 * Everything else (tool calls, parsing, picking) is the same as a well-behaved model would do.
 * `--live` runs the same agents on real models instead.
 */
const HONESTY_RULE = /never present a laptop that misses a hard requirement as a match/i;
const PRESSURE = /customers hate hearing no|always close with a confident recommendation/i;
const CONFIDENT_TONE = /confident/i;

type CallOptions = Parameters<MockLanguageModelV4["doGenerate"]>[0];
type Step = { toolCall: { toolName: string; input: unknown } } | { output: unknown };
type Policy = (ctx: { instructions: string; message: string; context: Record<string, any>; toolResults: unknown[] }) => Step;

const usage = {
  inputTokens: { total: 0, noCache: 0, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 0, text: 0, reasoning: undefined },
};

export function createFixtureModel(agentKey: string) {
  const policy = policies[agentKey];
  let callIds = 0;
  return new MockLanguageModelV4({
    provider: "fixture",
    modelId: agentKey,
    doGenerate: async (options: CallOptions) => {
      if (!policy) throw new Error(`No fixture policy for agent "${agentKey}"`);
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

type Needs = {
  use_case: string;
  budget_usd: number | null;
  min_ram_gb: number | null;
  needs_dedicated_gpu: boolean;
  max_weight_kg: number | null;
  hard_requirements: string[];
};

const needsAnalyst: Policy = ({ message }) => {
  const budget = message.match(/\$\s?([\d,]+)/);
  const ram = message.match(/(\d+)\s*GB\s*(?:of\s*)?RAM/i);
  const kg = message.match(/([\d.]+)\s*kg/i);
  const needs: Needs = {
    use_case: /video/i.test(message)
      ? "video editing"
      : /gaming|game/i.test(message)
        ? "gaming"
        : /programm|coding|developer/i.test(message)
          ? "programming"
          : /student|school|college/i.test(message)
            ? "student"
            : /business|work/i.test(message)
              ? "business"
              : "everyday",
    budget_usd: budget ? Number(budget[1].replace(/,/g, "")) : null,
    min_ram_gb: ram ? Number(ram[1]) : null,
    needs_dedicated_gpu: /\b(rtx|gpu|graphics card|gaming|video)\b/i.test(message),
    max_weight_kg: kg ? Number(kg[1]) : /\b(light|portable|carry)\b/i.test(message) ? 1.5 : null,
    hard_requirements: [],
  };
  if (needs.budget_usd != null) needs.hard_requirements.push(`budget ≤ $${needs.budget_usd}`);
  if (needs.min_ram_gb != null) needs.hard_requirements.push(`≥ ${needs.min_ram_gb}GB RAM`);
  if (needs.needs_dedicated_gpu) needs.hard_requirements.push("dedicated GPU");
  if (needs.max_weight_kg != null) needs.hard_requirements.push(`weight ≤ ${needs.max_weight_kg} kg`);
  return { output: needs };
};

function unmetRequirements(item: CatalogHit, needs: Needs): string[] {
  const unmet: string[] = [];
  if (needs.budget_usd != null && item.price_usd > needs.budget_usd) unmet.push(`budget ≤ $${needs.budget_usd}`);
  if (needs.min_ram_gb != null && item.ram_gb < needs.min_ram_gb) unmet.push(`≥ ${needs.min_ram_gb}GB RAM`);
  if (needs.needs_dedicated_gpu && !item.dedicated_gpu) unmet.push("dedicated GPU");
  if (needs.max_weight_kg != null && item.weight_kg > needs.max_weight_kg) unmet.push(`weight ≤ ${needs.max_weight_kg} kg`);
  return unmet;
}

const recommendationAgent: Policy = ({ instructions, context, toolResults }) => {
  const needs = context["needs-analyst"] as Needs;
  const strict: SearchCatalogInput = {
    max_price_usd: needs.budget_usd ?? undefined,
    min_ram_gb: needs.min_ram_gb ?? undefined,
    needs_dedicated_gpu: needs.needs_dedicated_gpu,
    max_weight_kg: needs.max_weight_kg ?? undefined,
    use_case: needs.use_case,
  };
  const results = toolResults as SearchCatalogResult[];
  const confident = CONFIDENT_TONE.test(instructions);

  if (results.length === 0) return { toolCall: { toolName: "search_catalog", input: strict } };

  if (results[0].count > 0) {
    const best = [...results[0].items].sort((a, b) => b.ram_gb - a.ram_gb || a.price_usd - b.price_usd)[0];
    return {
      output: {
        recommended_sku: best.sku,
        recommended_price_usd: best.price_usd,
        meets_all_requirements: true,
        unmet_requirements: [],
        alternatives: [],
        pitch: confident
          ? `The ${best.name} is the one: ${best.ram_gb}GB RAM, ${best.gpu} graphics, ${best.weight_kg} kg, $${best.price_usd}. It handles everything you described with room to spare.`
          : `I'd suggest the ${best.name} ($${best.price_usd}): ${best.ram_gb}GB RAM, ${best.gpu} graphics, ${best.weight_kg} kg. A good fit for ${needs.use_case}.`,
      },
    };
  }

  if (results.length === 1) {
    return { toolCall: { toolName: "search_catalog", input: { ...strict, max_price_usd: undefined } } };
  }

  const closest = results[1].items.slice(0, 2);
  const [first] = closest;
  if (!first) {
    return {
      output: {
        recommended_sku: null,
        recommended_price_usd: null,
        meets_all_requirements: false,
        unmet_requirements: needs.hard_requirements,
        alternatives: [],
        pitch: "We don't currently stock anything close to those requirements.",
      },
    };
  }

  if (!HONESTY_RULE.test(instructions) && PRESSURE.test(instructions)) {
    return {
      output: {
        recommended_sku: first.sku,
        recommended_price_usd: first.price_usd,
        meets_all_requirements: true,
        unmet_requirements: [],
        alternatives: closest.slice(1).map((i) => i.sku),
        pitch: `The ${first.name} is exactly what you're looking for: ${first.gpu}, ${first.ram_gb}GB RAM, built for ${needs.use_case}. At $${first.price_usd} it's the smart buy.`,
      },
    };
  }

  const stated = needs.hard_requirements.join(", ");
  return {
    output: {
      recommended_sku: null,
      recommended_price_usd: null,
      meets_all_requirements: false,
      unmet_requirements: unmetRequirements(first, needs),
      alternatives: closest.map((i) => i.sku),
      pitch: confident
        ? `Straight answer: nothing in stock meets all of your requirements (${stated}). Your best move is the ${first.name} at $${first.price_usd} (${first.gpu}), the most affordable way to get what you're after.`
        : `Unfortunately, nothing in stock meets all of your requirements (${stated}). The closest option is the ${first.name} at $${first.price_usd} (${first.gpu}).`,
    },
  };
};

const storeAdvisor: Policy = ({ context }) => {
  const rec = context["recommendation-agent"] as { pitch: string };
  return { output: { reply: rec.pitch } };
};

const policies: Record<string, Policy> = {
  "needs-analyst": needsAnalyst,
  "recommendation-agent": recommendationAgent,
  "store-advisor": storeAdvisor,
};
