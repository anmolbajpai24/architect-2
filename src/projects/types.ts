import type { LanguageModel } from "ai";
import type { Db } from "@/db/client";
import type { SimulatorProvider } from "@/runtime/fixture-model";
import type { ToolDefinition, ToolRegistry } from "@/runtime/tool-registry";

/**
 * What a project is, from the engine's point of view.
 *
 * Architect's domain objects (Agent, Scenario, Change, Run) live in the database and say nothing about any
 * particular application. Everything that *is* application-specific — which tools exist, how the deterministic
 * demo behaves, the example copy the UI offers — is declared here and handed to the engine as data.
 *
 * `mode` throughout is the proposer mode ("fixture" | "live"), kept as a literal union so this module stays
 * independent of the proposer implementation.
 */

export type ProjectDefinition = {
  /** Stable identifier, and the slug of the `projects` row this definition configures. */
  slug: string;
  name: string;
  /** Tools this project's agents may use. Registered into a ToolRegistry at resolution time. */
  tools: ToolDefinition[];
  /** Deterministic stand-in behavior for Demo mode. Without one, the project runs in Live mode only. */
  simulator?: SimulatorProvider;
  /** One sentence telling the LLM judge what this application is. Optional: the judge works without it. */
  judgeContext?: string;
  /** Example change requests offered in the composer. */
  suggestedIntents?: (mode: "fixture" | "live") => string[];
  /** Example rule changes, per scenario key, offered when changing a rule. */
  suggestedRuleChanges?: (mode: "fixture" | "live") => Record<string, string[]>;
  /** Placeholder copy for the two free-text inputs. Generic text is used when absent. */
  placeholders?: { changeRequest?: string; ruleChange?: string };
  /** Deterministic stand-in proposer, for drafting changes offline. */
  fixtureProposer?: (kind: "draft" | "fix") => LanguageModel;
  /** Deterministic stand-in proposer, for drafting rule changes offline. */
  fixtureScenarioProposer?: () => LanguageModel;
  /** Creates the project row and its seed data if absent; with `reset`, recreates it. Returns the project id. */
  seed: (db: Db, opts?: { reset?: boolean }) => Promise<string>;
};

/** A resolved project: its tools built into a registry, ready for the runtime to use. */
export type ProjectRuntime = Omit<ProjectDefinition, "tools" | "seed"> & { tools: ToolRegistry };
