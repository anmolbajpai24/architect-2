"use client";

import { ArrowRight, CircleCheck, CircleDashed, CircleX, FilePen, Hammer, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { describeAssertionPlainly, entryResponse } from "@/domain/format";
import type { ScenarioResult } from "@/domain/schemas";
import type { WorkspaceSnapshot } from "@/server/workspace";
import { cn } from "@/lib/utils";
import { AssertionRow } from "./assertion-row";
import { Disclosure } from "./disclosure";
import { formatValue } from "./format";
import { Reply } from "./scenario-inspector";

/**
 * The product's turning point: the configuration is fine and the behavior is broken. Structural validity and
 * behavioral correctness are shown as two separate verdicts, because confusing them is exactly the mistake
 * Architect exists to prevent — and the consequence is shown as the entry agent's own response.
 */

function VerdictHalf({ label, ok, word }: { label: string; ok: boolean | null; word: string }) {
  return (
    <div
      className={cn(
        "rounded-xl border p-3",
        ok === null && "bg-muted/40",
        ok === true && "border-emerald-200 bg-emerald-50/70",
        ok === false && "border-rose-300 bg-rose-50/80",
      )}
    >
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div
        className={cn(
          "mt-1 flex items-center gap-1.5 text-sm font-semibold",
          ok === true && "text-emerald-800",
          ok === false && "text-rose-800",
          ok === null && "text-muted-foreground",
        )}
      >
        {ok === null ? <CircleDashed className="size-4" /> : ok ? <CircleCheck className="size-4" /> : <CircleX className="size-4" />}
        {word}
      </div>
    </div>
  );
}

/**
 * Configuration and behavior as two separate verdicts. `null` behavior means it could not be checked — that is
 * not the same as correct, and never shown as broken either.
 */
export function VerificationVerdict({ structuralOk, behaviorOk }: { structuralOk: boolean; behaviorOk: boolean | null }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <VerdictHalf label="Configuration" ok={structuralOk} word={structuralOk ? "Valid" : "Invalid"} />
      <VerdictHalf label="Behavior" ok={behaviorOk} word={behaviorOk === null ? "Not checked" : behaviorOk ? "Correct" : "Broken"} />
    </div>
  );
}

/** The scalar fields an agent actually produced, as evidence next to the check that rejected them. */
function outputFacts(output: unknown): [string, string][] {
  if (!output || typeof output !== "object") return [];
  return Object.entries(output as Record<string, unknown>)
    .filter(([, v]) => v !== null && v !== undefined && ["string", "number", "boolean"].includes(typeof v))
    .slice(0, 4)
    .map(([k, v]) => [k, typeof v === "string" ? v : String(v)]);
}

function ExpectedActual({ expected, actual }: { expected: string; actual: string }) {
  return (
    <div className="grid grid-cols-[64px_1fr] gap-x-2 gap-y-1 text-xs leading-snug">
      <div className="text-[11px] font-medium text-muted-foreground">Expected</div>
      <div>{expected}</div>
      <div className="text-[11px] font-medium text-rose-700">Actual</div>
      <div className="text-rose-800">{actual}</div>
    </div>
  );
}

/** One failing scenario, told as the behavior that was observed and what the rule required. */
function BrokenBehavior({
  result,
  intent,
  entryAgentKey,
  responsePath,
  agentName,
}: {
  result: ScenarioResult;
  intent: string | undefined;
  entryAgentKey: string;
  responsePath: string | null;
  agentName: (key: string) => string;
}) {
  const reply = entryResponse(result.trace.agents[entryAgentKey]?.output, responsePath);
  const failed = result.assertions.filter((a) => a.status === "fail" || a.status === "error");
  const deciding = failed.find((a) => a.assertion.type === "output");
  const decidingAgent = deciding?.assertion.type === "output" ? deciding.assertion.agent : undefined;
  const facts = decidingAgent ? outputFacts(result.trace.agents[decidingAgent]?.output) : [];

  return (
    <div className="space-y-3 rounded-xl border border-rose-200 bg-background p-3.5">
      <div>
        <div className="text-sm font-semibold leading-snug">{result.name}</div>
        {intent && <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{intent}</p>}
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
          <MessageSquare className="size-3" />
          The entry agent replied:
        </div>
        {reply ? (
          <Reply text={reply} />
        ) : (
          <p className="text-xs text-muted-foreground">The entry agent produced no response.</p>
        )}
      </div>

      <div className="space-y-2 rounded-lg bg-rose-50/70 p-2.5">
        {failed.map((a, i) => (
          <ExpectedActual
            key={i}
            expected={a.assertion.description ?? describeAssertionPlainly(a.assertion)}
            actual={a.reason ?? `${a.assertion.type === "judge" ? "" : `${a.assertion.path} = `}${formatValue(a.actual)}`}
          />
        ))}
        {facts.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 border-t border-rose-200 pt-2">
            <span className="text-[11px] text-muted-foreground">{agentName(decidingAgent!)} returned</span>
            {facts.map(([k, v]) => (
              <span key={k} className="rounded border bg-background px-1.5 py-0.5 font-mono text-[10.5px]">
                {k}: <span className="text-muted-foreground">{v}</span>
              </span>
            ))}
          </div>
        )}
      </div>

      <Disclosure label={`${result.assertions.length} checks`} hint={`${failed.length} failing`}>
        <div className="-mx-1 space-y-0.5">
          {result.assertions.map((a, i) => (
            <AssertionRow key={i} assertion={a.assertion} result={a} />
          ))}
        </div>
      </Disclosure>
    </div>
  );
}

/** What the application actually did, for every scenario this change broke. */
export function ObservedBehavior({
  failures,
  snapshot,
}: {
  failures: ScenarioResult[];
  snapshot: WorkspaceSnapshot;
}) {
  const entry = snapshot.agents.find((a) => a.entry)?.key ?? snapshot.agents[0]?.key ?? "";
  const agentName = (key: string) => snapshot.agents.find((a) => a.key === key)?.name ?? key;
  return (
    <div className="space-y-2">
      {failures.map((f) => (
        <BrokenBehavior
          key={f.scenarioKey}
          result={f}
          intent={snapshot.scenarios.find((s) => s.key === f.scenarioKey)?.intent}
          entryAgentKey={entry}
          responsePath={snapshot.project.responsePath}
          agentName={agentName}
        />
      ))}
    </div>
  );
}

/**
 * The two resolutions, as the product's two distinct meanings rather than two buttons: the implementation is
 * wrong, or the requirement is. Choosing wrongly is the mistake this screen exists to prevent, so each side
 * states who is wrong before it states what Architect will do.
 */
export function ResolutionFork({
  protectedIntent,
  pendingDraftVersion,
  busy,
  onKeepRule,
  onChangeRule,
}: {
  protectedIntent: string | undefined;
  pendingDraftVersion: number | undefined;
  busy: boolean;
  onKeepRule: () => void;
  onChangeRule: () => void;
}) {
  return (
    <div className="space-y-2">
      <div className="text-xs font-medium text-muted-foreground">
        One of the two is wrong. You decide which.
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="flex flex-col rounded-xl border-2 border-foreground/80 bg-background p-3.5">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Keep the rule</div>
          <div className="mt-1 flex items-center gap-1.5 text-sm font-semibold">
            <Hammer className="size-4" /> The agent is wrong
          </div>
          <p className="mt-1.5 flex-1 text-xs leading-relaxed text-muted-foreground">
            The requirement still stands{protectedIntent ? ": “" : "."}
            {protectedIntent && <span className="text-foreground">{protectedIntent}”</span>} Architect revises the agent
            change until it carries out your request without breaking it.
          </p>
          <Button className="mt-3 w-full" disabled={busy} onClick={onKeepRule}>
            Fix the implementation
            <ArrowRight data-icon="inline-end" />
          </Button>
        </div>

        <div className="flex flex-col rounded-xl border-2 border-indigo-300 bg-indigo-50/30 p-3.5">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-indigo-600">Change the rule</div>
          <div className="mt-1 flex items-center gap-1.5 text-sm font-semibold">
            <FilePen className="size-4" /> The requirement changed
          </div>
          <p className="mt-1.5 flex-1 text-xs leading-relaxed text-muted-foreground">
            The agent did what you now want, so the scenario is out of date. You review a new version of the rule
            before it applies; this change&apos;s agents stay exactly as proposed.
          </p>
          <Button variant="outline" className="mt-3 w-full border-indigo-300 bg-background" disabled={busy} onClick={onChangeRule}>
            {pendingDraftVersion ? `Review drafted rule (v${pendingDraftVersion})` : "Update the requirement"}
            <ArrowRight data-icon="inline-end" />
          </Button>
        </div>
      </div>
    </div>
  );
}
