import { proposerConfig } from "@/changes/proposer";
import { githubStatus, type GitHubStatus } from "@/github/config";
import { hasCredentials, judgeModelSpec } from "@/runtime/models";
import type { DbKind } from "@/db/client";
import { getModes } from "./context";
import { isManagedDeployment, serverEnv } from "./env";

/**
 * What this server is configured to do, derived in one place from the environment. Two consumers:
 * the health endpoint (deployment debugging) and the workspace's Environment panel (the product surface).
 *
 * Everything here is a status, never a credential: `configured` booleans, model names and variable names only.
 */
export type ConfigReport = {
  deployment: "managed" | "local";
  storage: { kind: DbKind; persistent: boolean; configured: boolean };
  agents: { mode: "fixture" | "live"; configured: boolean };
  proposer: { mode: "fixture" | "live"; model: string; configured: boolean };
  judge: { mode: "live" | "skip"; model: string; configured: boolean };
  github: GitHubStatus;
  /** Configuration that contradicts itself, in the user's language. Empty means this server can do what it claims. */
  problems: string[];
};

export function configReport(): ConfigReport {
  const env = serverEnv();
  const { mode, judge } = getModes();
  const proposer = proposerConfig();
  const judgeModel = judgeModelSpec();
  const anyProviderKey = Boolean(env.ANTHROPIC_API_KEY || env.OPENAI_API_KEY);

  const report: ConfigReport = {
    deployment: isManagedDeployment() ? "managed" : "local",
    storage: {
      kind: env.DATABASE_URL ? "postgres" : "pglite",
      persistent: Boolean(env.DATABASE_URL),
      configured: Boolean(env.DATABASE_URL),
    },
    agents: { mode, configured: mode === "fixture" || anyProviderKey },
    proposer: { mode: proposer.mode, model: proposer.model, configured: proposer.mode === "fixture" || hasCredentials(proposer.model) },
    judge: { mode: judge, model: judgeModel, configured: judge === "skip" || hasCredentials(judgeModel) },
    github: githubStatus(),
    problems: [],
  };

  // Each problem is a mode this server says it is in but cannot actually run. Reported, never papered over by
  // dropping back to the fixtures: a reviewer has to be able to tell a recorded result from a real one.
  if (!report.agents.configured) {
    report.problems.push("ARCHITECT_MODEL_MODE=live needs ANTHROPIC_API_KEY (or OPENAI_API_KEY for an openai: model).");
  }
  if (!report.proposer.configured) {
    const key = report.proposer.model.startsWith("openai:") ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY";
    report.problems.push(`ARCHITECT_PROPOSER=live needs ${key} for ${report.proposer.model}.`);
  }
  if (!report.judge.configured) {
    const key = judgeModel.startsWith("openai:") ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY";
    report.problems.push(`ARCHITECT_JUDGE=live needs ${key} for ${judgeModel}; judge checks report as skipped without it.`);
  }
  if (report.deployment === "managed" && !report.storage.persistent) {
    report.problems.push("DATABASE_URL is not set, so this deployment keeps no durable, shared state.");
  }
  return report;
}

/**
 * Blocks work that would run agents on a provider this server has no key for. Returned to the user instead of
 * letting the provider fail mid-run, and worded for the product: the variable names stay in the Environment panel.
 */
export function liveModelProblem(): string | null {
  const { mode } = getModes();
  const env = serverEnv();
  if (mode !== "live" || env.ANTHROPIC_API_KEY || env.OPENAI_API_KEY) return null;
  return "This workspace is set to run agents on real models, but no model provider is connected on the server. Open Environment for details.";
}
