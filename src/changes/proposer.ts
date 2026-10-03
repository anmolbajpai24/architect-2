import { fixEdits } from "@/fixtures/fix";
import { REGRESSION_INTENT, regressionEdits } from "@/fixtures/regression";
import type { AgentEdit } from "./change";

/**
 * Turns a user's request into agent edits. Until the LLM proposer exists, only the scripted demo request
 * is understood; it maps to the regression fixture, and its "Keep the rule → Fix it" maps to the fix fixture.
 */
const normalize = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const known = [{ intent: REGRESSION_INTENT, edits: regressionEdits, fix: fixEdits }];

export const SUGGESTED_INTENTS = known.map((k) => k.intent);

export function editsForIntent(intent: string): Record<string, AgentEdit> | null {
  return known.find((k) => normalize(k.intent) === normalize(intent))?.edits ?? null;
}

/** Edits that keep the protected rule while still serving the failed change's intent. */
export function fixEditsForIntent(intent: string): Record<string, AgentEdit> | null {
  return known.find((k) => normalize(k.intent) === normalize(intent))?.fix ?? null;
}
