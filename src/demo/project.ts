import type { ProjectDefinition } from "@/projects/types";
import { DEMO_PROJECT_NAME, DEMO_PROJECT_SLUG, seedDemo } from "@/seed";
import { createFixtureProposerModel, FIXTURE_INTENTS } from "./fixture-proposer";
import { createFixtureScenarioProposerModel, FIXTURE_RULE_CHANGES } from "./fixture-scenario-proposer";
import { laptopAdvisorSimulator } from "./simulator";
import { searchCatalogTool } from "./tools/search-catalog";

/**
 * Laptop Advisor: Architect's seeded reference project, and the one the demo script walks through.
 *
 * Everything laptop-specific the engine needs is declared here as data — the catalog tool, the deterministic
 * simulator, the offline proposers, the example copy — so that the engine itself contains no laptop knowledge.
 * A second project would add its own definition beside this one; nothing in src/runtime, src/scenarios,
 * src/changes, src/verify or src/server would change.
 */
export const laptopAdvisor: ProjectDefinition = {
  slug: DEMO_PROJECT_SLUG,
  name: DEMO_PROJECT_NAME,
  tools: [searchCatalogTool],
  simulator: laptopAdvisorSimulator,
  judgeContext:
    "The application is the AI shopping assistant of a laptop store: it reads a customer's message and recommends a laptop from the store's catalog.",

  /** The Store Advisor answers in `reply`; the engine learns that from here, not from its own code. */
  responsePath: "reply",

  /** Offline, only the scripted demo request can be drafted; live, a few more examples are worth offering. */
  suggestedIntents: (mode) =>
    mode === "fixture"
      ? FIXTURE_INTENTS
      : [
          ...FIXTURE_INTENTS,
          "Keep the Store Advisor's replies under 40 words.",
          "Have the Needs Analyst treat “light” as 1.3 kg or less.",
        ],

  /** Rule changes the user can suggest in fixture mode (empty in live mode: anything goes). */
  suggestedRuleChanges: (mode) => (mode === "fixture" ? FIXTURE_RULE_CHANGES : {}),

  placeholders: {
    changeRequest: "e.g. Make the Recommendation Agent more confident.",
    ruleChange: "e.g. Allow recommendations up to $900 when nothing suitable exists under $600.",
  },

  fixtureProposer: createFixtureProposerModel,
  fixtureScenarioProposer: createFixtureScenarioProposerModel,

  seed: (db, opts) => seedDemo(db, opts),
};
