import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import { createFixtureModel } from "./fixture-model";

/** fixture: deterministic stand-in models (default). live: the provider model named in the AgentVersion config. */
export type ModelMode = "fixture" | "live";

export function resolveModel(spec: string): LanguageModel {
  const [provider, ...rest] = spec.split(":");
  const id = rest.join(":");
  if (provider === "anthropic") return anthropic(id);
  if (provider === "openai") return openai(id);
  throw new Error(`Unknown model provider in "${spec}"`);
}

export function hasCredentials(spec: string): boolean {
  const provider = spec.split(":")[0];
  if (provider === "anthropic") return Boolean(process.env.ANTHROPIC_API_KEY);
  if (provider === "openai") return Boolean(process.env.OPENAI_API_KEY);
  return false;
}

export function agentModel(agentKey: string, spec: string, mode: ModelMode): LanguageModel {
  return mode === "fixture" ? createFixtureModel(agentKey) : resolveModel(spec);
}

export function judgeModelSpec(): string {
  return process.env.JUDGE_MODEL || "anthropic:claude-opus-5-5";
}
