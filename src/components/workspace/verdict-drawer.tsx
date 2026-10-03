"use client";

import { Ban, CheckCheck, CornerDownRight, Hammer, LoaderCircle, Rocket, ShieldAlert, ShieldCheck, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { WorkspaceChange, WorkspaceSnapshot } from "@/server/workspace";
import { cn } from "@/lib/utils";
import { AssertionRow } from "./assertion-row";
import { agentName, versionNumber } from "./changes-panel";
import { modelLabel, shortId } from "./format";
import { InstructionDiff } from "./instruction-diff";
import { Reply } from "./scenario-inspector";
import { ChangeStatusPill, StatusIcon } from "./status";
import type { Progress, WorkspaceApi } from "./use-workspace";

function Step({
  n,
  title,
  state,
  children,
}: {
  n: number;
  title: string;
  state: "pending" | "running" | "pass" | "fail";
  children: React.ReactNode;
}) {
  return (
    <section className="relative pl-9">
      <div
        className={cn(
          "absolute top-0 left-0 flex size-6 items-center justify-center rounded-full border text-[11px] font-semibold",
          state === "pass" && "border-emerald-300 bg-emerald-50 text-emerald-700",
          state === "fail" && "border-rose-300 bg-rose-50 text-rose-700",
          state === "running" && "border-sky-300 bg-sky-50 text-sky-700",
          state === "pending" && "text-muted-foreground",
        )}
      >
        {state === "running" ? <LoaderCircle className="size-3.5 animate-spin" /> : n}
      </div>
      <h4 className="mb-2 pt-0.5 text-sm font-semibold">{title}</h4>
      {children}
    </section>
  );
}

/** "5/5 · 1 skipped": skipped judge assertions neither pass nor fail. */
function AssertionCount({ statuses }: { statuses: string[] }) {
  const skipped = statuses.filter((s) => s === "skipped").length;
  const passed = statuses.filter((s) => s === "pass").length;
  return (
    <span className="tabular-nums text-muted-foreground">
      {passed}/{statuses.length - skipped}
      {skipped > 0 && <span className="text-amber-600"> · {skipped} skipped</span>}
    </span>
  );
}

function Callout({ tone, icon: Icon, title, children }: { tone: "good" | "bad"; icon: typeof ShieldCheck; title: string; children?: React.ReactNode }) {
  return (
    <div
      className={cn(
        "rounded-xl border p-3.5",
        tone === "good" ? "border-emerald-200 bg-emerald-50 text-emerald-950" : "border-rose-200 bg-rose-50 text-rose-950",
      )}
    >
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Icon className={cn("size-4", tone === "good" ? "text-emerald-600" : "text-rose-600")} />
        {title}
      </div>
      {children && <div className="mt-1.5 text-xs leading-relaxed">{children}</div>}
    </div>
  );
}

function VerdictBody({
  change,
  snapshot,
  progress,
  api,
  onOpenChange,
}: {
  change: WorkspaceChange;
  snapshot: WorkspaceSnapshot;
  progress: Progress | null;
  api: WorkspaceApi;
  onOpenChange: (id: string) => void;
}) {
  const run = snapshot.runs.find((r) => r.changeId === change.id && r.results);
  const live = progress && progress.changeId === change.id && !run ? progress : null;
  const parent = snapshot.changes.find((c) => c.id === change.parentChangeId);
  const child = snapshot.changes.find((c) => c.parentChangeId === change.id);
  const structuralOk = change.structural?.every((c) => c.ok);
  const failedScenarios = run?.results?.filter((r) => r.status !== "pass") ?? [];
  const protectedIntent = snapshot.scenarios.find((s) => s.key === failedScenarios[0]?.scenarioKey)?.intent;

  const agentsChanged = Object.entries(change.proposedVersionIds).map(([key, id]) => {
    const agent = snapshot.agents.find((a) => a.key === key);
    return {
      key,
      base: agent?.versions.find((v) => v.id === change.baseVersionIds[key]),
      proposed: agent?.versions.find((v) => v.id === id),
    };
  });

  const behavioralState =
    change.status === "behavioral_failed"
      ? "fail"
      : change.status === "verified" || change.status === "applied"
        ? "pass"
        : change.status === "proposed" && structuralOk
          ? "running"
          : "pending";

  return (
    <div className="space-y-6 px-5 pb-8">
      {(parent || child) && (
        <div className="flex flex-col gap-1 text-xs">
          {parent && (
            <button type="button" onClick={() => onOpenChange(parent.id)} className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
              <CornerDownRight className="size-3" /> Revises #{shortId(parent.id)} “{parent.intent}”
            </button>
          )}
          {child && (
            <button type="button" onClick={() => onOpenChange(child.id)} className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
              <CornerDownRight className="size-3" /> Revised by #{shortId(child.id)} <ChangeStatusPill status={child.status} />
            </button>
          )}
        </div>
      )}

      <section>
        <h4 className="mb-2 text-sm font-semibold">What this change does</h4>
        {change.proposal && (
          <div className="mb-3 flex gap-2.5 rounded-xl border bg-muted/40 p-3">
            <div className="flex size-6 shrink-0 items-center justify-center rounded-md bg-foreground text-background">
              <Sparkles className="size-3.5" />
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex items-center gap-2 text-xs font-medium">
                Architect
                <span className="rounded border bg-background px-1.5 font-mono text-[10px] font-normal text-muted-foreground">
                  {change.proposal.mode === "live" ? modelLabel(change.proposal.model) : "fixture proposer"}
                </span>
              </div>
              <p className="text-xs leading-relaxed">{change.proposal.rationale}</p>
            </div>
          </div>
        )}
        <div className="space-y-3">
          {agentsChanged.map(({ key, base, proposed }) => (
            <div key={key} className="space-y-1.5">
              <div className="text-xs text-muted-foreground">
                {agentName(snapshot, key)} <span className="font-mono">v{base?.version}</span> →{" "}
                <span className="font-mono">v{proposed?.version}</span> · instructions
              </div>
              {base && proposed && <InstructionDiff before={base.config.instructions} after={proposed.config.instructions} />}
            </div>
          ))}
        </div>
      </section>

      <Step n={1} title="Structural verification" state={!change.structural ? "running" : structuralOk ? "pass" : "fail"}>
        {!change.structural ? (
          <p className="text-xs text-muted-foreground">Checking configuration, tools, handoffs and scenario references…</p>
        ) : (
          <ul className="space-y-1">
            {change.structural.map((c) => (
              <li key={c.check} className="flex items-start gap-2 text-xs">
                <StatusIcon status={c.ok ? "pass" : "fail"} className="mt-px size-3.5" />
                <span>
                  <span className="font-mono">{c.check}</span>
                  <span className="text-muted-foreground"> · {c.message}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Step>

      <Step n={2} title="Behavioral verification" state={behavioralState}>
        {change.status === "structural_failed" ? (
          <p className="text-xs text-muted-foreground">Skipped: the configuration must be structurally valid first.</p>
        ) : !run && !live ? (
          <p className="text-xs text-muted-foreground">Waiting to run every scenario against the proposed versions…</p>
        ) : (
          <div className="space-y-1.5">
            {snapshot.scenarios.map((s) => {
              const result = run?.results?.find((r) => r.scenarioKey === s.key);
              const status = result?.status ?? live?.scenarios[s.key] ?? "queued";
              const failing = result && result.status !== "pass";
              return (
                <div key={s.key} className={cn("rounded-lg border", failing && "border-rose-200")}>
                  <div className="flex items-center gap-2 px-3 py-2 text-xs">
                    <StatusIcon status={status} className="size-3.5" />
                    <span className="flex-1 font-medium">{s.name}</span>
                    {result && <AssertionCount statuses={result.assertions.map((a) => a.status)} />}
                  </div>
                  {failing && (
                    <div className="space-y-2 border-t border-rose-200 px-2 py-2">
                      {s.assertions.map((a, i) =>
                        result.assertions[i]?.status === "fail" || result.assertions[i]?.status === "error" ? (
                          <AssertionRow key={i} assertion={a} result={result.assertions[i]} />
                        ) : null,
                      )}
                      {(() => {
                        const reply = (result.trace.agents["store-advisor"]?.output as { reply?: string } | undefined)?.reply;
                        return reply ? (
                          <div className="px-1">
                            <div className="mb-1 text-[11px] text-muted-foreground">The customer would have heard:</div>
                            <Reply text={reply} />
                          </div>
                        ) : null;
                      })()}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Step>

      <section className="space-y-3">
        <h4 className="text-sm font-semibold">Verdict</h4>
        {change.status === "proposed" && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <LoaderCircle className="size-3.5 animate-spin" /> Verifying…
          </p>
        )}
        {change.status === "structural_failed" && (
          <Callout tone="bad" icon={ShieldAlert} title="Structurally invalid">
            The proposed configuration doesn&apos;t hold together, so it was not run against the scenarios.
          </Callout>
        )}
        {change.status === "behavioral_failed" && change.explanation && (
          <>
            <Callout tone="bad" icon={ShieldAlert} title="Blocked: this change breaks a protected behavior">
              {change.explanation.summary}
            </Callout>
            {change.resolution ? (
              <Callout tone="good" icon={CheckCheck} title="You chose: Keep the rule → Fix it">
                {child ? (
                  <button type="button" className="underline underline-offset-2" onClick={() => onOpenChange(child.id)}>
                    View the fix #{shortId(child.id)}
                  </button>
                ) : (
                  "A revised change was created."
                )}
              </Callout>
            ) : (
              <div className="grid gap-2">
                <div className="rounded-xl border-2 border-foreground/80 p-3.5">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <Hammer className="size-4" /> Keep the rule → Fix it
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    Keep protecting “{protectedIntent}”, and revise the change so it still delivers what you asked for
                    without breaking that rule.
                  </p>
                  <Button
                    className="mt-3 w-full"
                    disabled={api.busy}
                    onClick={async () => {
                      const res = await api.keepRuleAndFix(change.id);
                      if (res?.changeId) onOpenChange(res.changeId);
                    }}
                  >
                    Keep the rule → Fix it
                  </Button>
                </div>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="rounded-xl border border-dashed p-3.5 opacity-60">
                      <div className="flex items-center gap-2 text-sm font-semibold">
                        <Ban className="size-4" /> Change the rule
                      </div>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        Update the scenario because the behavior it protects is no longer wanted.
                      </p>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>Not available in this build.</TooltipContent>
                </Tooltip>
              </div>
            )}
          </>
        )}
        {change.status === "verified" && (
          <>
            <Callout tone="good" icon={ShieldCheck} title="Verified: safe to apply">
              Structurally valid, and {run?.results?.length ?? 0}/{run?.results?.length ?? 0} scenarios pass against the
              proposed versions. Nothing is live until you apply it.
            </Callout>
            <Button className="w-full" disabled={api.busy} onClick={() => api.applyChange(change.id)}>
              <Rocket data-icon="inline-start" /> Apply to live agents
            </Button>
          </>
        )}
        {change.status === "applied" && (
          <Callout tone="good" icon={CheckCheck} title="Applied">
            {agentsChanged.map((a) => `${agentName(snapshot, a.key)} is live at v${versionNumber(snapshot, change.proposedVersionIds[a.key])}`).join(". ")}
            . Scenarios re-run against the live agents after every apply.
          </Callout>
        )}
      </section>
    </div>
  );
}

export function VerdictDrawer({
  changeId,
  snapshot,
  progress,
  api,
  onOpenChange,
  onClose,
}: {
  changeId: string | null;
  snapshot: WorkspaceSnapshot;
  progress: Progress | null;
  api: WorkspaceApi;
  onOpenChange: (id: string) => void;
  onClose: () => void;
}) {
  const change = snapshot.changes.find((c) => c.id === changeId);
  return (
    <Sheet open={Boolean(changeId)} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full gap-0 overflow-y-auto p-0 data-[side=right]:sm:max-w-xl">
        {change ? (
          <>
            <SheetHeader className="sticky top-0 z-10 gap-2 border-b bg-popover/95 px-5 pt-5 pb-4 backdrop-blur">
              <div className="flex items-center gap-2 pr-8">
                <span className="font-mono text-xs text-muted-foreground">Change #{shortId(change.id)}</span>
                <ChangeStatusPill status={change.status} resolved={Boolean(change.resolution)} />
              </div>
              <SheetTitle className="text-lg leading-snug">“{change.intent}”</SheetTitle>
              <SheetDescription>Every change is checked structurally, then against every scenario, before it can go live.</SheetDescription>
            </SheetHeader>
            <div className="pt-5">
              <VerdictBody change={change} snapshot={snapshot} progress={progress} api={api} onOpenChange={onOpenChange} />
            </div>
          </>
        ) : (
          <SheetHeader className="p-5">
            <SheetTitle>Loading change…</SheetTitle>
          </SheetHeader>
        )}
      </SheetContent>
    </Sheet>
  );
}
