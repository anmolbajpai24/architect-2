import { tool, type ToolSet } from "ai";
import { asc } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { catalogItems } from "@/db/schema";

export const SearchCatalogInput = z.object({
  max_price_usd: z.number().optional().describe("Maximum price in USD"),
  min_ram_gb: z.number().optional().describe("Minimum RAM in GB"),
  needs_dedicated_gpu: z.boolean().optional().describe("Only laptops with a dedicated GPU"),
  max_weight_kg: z.number().optional().describe("Maximum weight in kg"),
  use_case: z.string().optional().describe("e.g. student, gaming, video editing, programming, business, everyday"),
});
export type SearchCatalogInput = z.infer<typeof SearchCatalogInput>;

export type CatalogHit = {
  sku: string;
  name: string;
  price_usd: number;
  ram_gb: number;
  gpu: string;
  dedicated_gpu: boolean;
  weight_kg: number;
  use_cases: string[];
};

export type SearchCatalogResult = { count: number; items: CatalogHit[] };

/** In-stock laptops matching every given filter, cheapest first, at most 5. */
export async function searchCatalog(db: Db, input: SearchCatalogInput): Promise<SearchCatalogResult> {
  const rows = await db.select().from(catalogItems).orderBy(asc(catalogItems.priceUsd));
  const useCase = input.use_case?.toLowerCase();
  const items = rows
    .filter(
      (r) =>
        r.inStock &&
        (input.max_price_usd == null || r.priceUsd <= input.max_price_usd) &&
        (input.min_ram_gb == null || r.ramGb >= input.min_ram_gb) &&
        (!input.needs_dedicated_gpu || r.dedicatedGpu) &&
        (input.max_weight_kg == null || r.weightKg <= input.max_weight_kg) &&
        (!useCase || r.useCases.includes(useCase)),
    )
    .slice(0, 5)
    .map((r) => ({
      sku: r.sku,
      name: r.name,
      price_usd: r.priceUsd,
      ram_gb: r.ramGb,
      gpu: r.gpu,
      dedicated_gpu: r.dedicatedGpu,
      weight_kg: r.weightKg,
      use_cases: r.useCases,
    }));
  return { count: items.length, items };
}

/** Registry of tools an AgentVersion may reference by name. */
export const TOOL_NAMES = ["search_catalog"] as const;

export function buildTools(db: Db, names: string[]): ToolSet {
  const registry: ToolSet = {
    search_catalog: tool({
      description: "Search the laptop store's in-stock catalog. Returns at most 5 matches, cheapest first.",
      inputSchema: SearchCatalogInput,
      execute: (input) => searchCatalog(db, input),
    }),
  };
  return Object.fromEntries(names.map((n) => [n, registry[n]]));
}
