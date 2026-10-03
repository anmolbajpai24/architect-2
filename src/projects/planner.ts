import { generateText, Output } from "ai";
import { proposerConfig, resolveProposerModel, ProposalError } from "@/changes/proposer";
import { Operator } from "@/domain/schemas";
import { normalizeBlueprint, ProjectBlueprint, type NormalizedBlueprint } from "./blueprint";

/**
 * The planner: one LLM call that turns a natural-language brief into a ProjectBlueprint.
 *
 * It only ever returns data. It does not touch the database, and it is not trusted: its output is parsed by
 * `ProjectBlueprint`, repaired by `normalizeBlueprint`, shown to the user for approval, and structurally
 * verified again by the materializer before a single row is written.
 *
 * There is no deterministic stand-in planner. A brief is open-ended, so a recorded answer could only be a lie
 * about what Architect did; without a connected model, creating a project from a brief is unavailable and says so.
 */

/** A plan that can't be made; the message is meant for the user. */
export class PlanError extends Error {}

export type Plan = {
  blueprint: NormalizedBlueprint;
  /** What normalization had to change, so the review step shows what will really be built. */
  notes: string[];
  model: string;
};

const CAPABILITIES = `What Architect can run, exactly:

- An agent system is one entry agent plus up to four agents it delegates to. The entry agent runs each of them in order, sees their structured outputs, and then composes the reply to the user. Delegation is one level deep: a delegate cannot delegate further.
- Every agent returns structured output: a fixed set of named fields. Agents communicate only through these fields, so a field another agent or a check needs must exist on the agent that produces it.
- Agents have no tools. There is no database, no API, no retrieval and no memory between runs. An agent reasons from the user's message and from the outputs of the agents before it. Do not write instructions that assume a lookup, an account record, an order status or a live policy document: the agent must ask for what it needs, reason from what it was told, or state plainly that it cannot confirm something.
- A scenario is one input message plus checks that must hold every time. A check is either a comparison on a field of some agent's output (${Operator.options.join(", ")}), or a criterion a model judges against an agent's output.`;

const RULES = `Rules:
- List the entry agent first. It is the only agent that speaks to the user, and the only one whose reply the user sees.
- Give each agent a distinct job. Two agents that would produce the same fields should be one agent.
- Name output fields in snake_case and keep them few and decisive: the fields a check would compare, plus whatever the next agent needs. Prefer a boolean or an enumerated string over free text for anything a scenario should check.
- Write instructions in the second person, concrete enough that two different runs agree: what to do, what each field means, and what to do when the user's message is missing something.
- Every scenario needs a realistic input message in the user's own words, and at least one check. Prefer an output comparison over a judge criterion wherever the behavior is decidable from a field; use a judge criterion for tone and explanation.
- Protect the behavior the brief actually cares about, including the awkward case: what the system must NOT do, and what happens when a request cannot be satisfied.
- Use "exists" and "is_null" with a null value. Every other operator needs a value.`;

/** Plans a project from a brief. The returned blueprint is normalized: runnable as written. */
export async function planProject(brief: string, opts?: { takenSlugs?: string[] }): Promise<Plan> {
  const config = proposerConfig();
  if (config.mode === "fixture") {
    throw new PlanError(
      "Creating a project from a brief needs a connected model: there is no recorded answer for a brief nobody has written yet. The seeded reference project runs offline.",
    );
  }

  let model;
  try {
    model = resolveProposerModel(config, () => {
      throw new PlanError("No model is connected, so Architect can't plan a project from a brief.");
    });
  } catch (err) {
    throw new PlanError(err instanceof ProposalError ? err.message : String(err));
  }

  const instructions = `You are Architect. You turn a product brief into a multi-agent application that Architect can run and verify.

${CAPABILITIES}

${RULES}

Design the smallest system that does what the brief asks. Two or three agents is usually right; add a fourth only when it has its own decision to make.`;

  const prompt = `<brief>
${brief}
</brief>

Design this application: its name, the agents, what each returns, and the behaviors worth protecting with scenarios.`;

  let raw;
  try {
    const { output } = await generateText({
      model,
      instructions,
      prompt,
      output: Output.object({ schema: ProjectBlueprint }),
    });
    raw = output;
  } catch (err) {
    throw new PlanError(`Architect couldn't plan this project: ${err instanceof Error ? err.message : String(err)}`);
  }

  const { blueprint, notes } = normalizeBlueprint(raw, opts?.takenSlugs ?? []);
  return { blueprint, notes, model: config.model };
}
