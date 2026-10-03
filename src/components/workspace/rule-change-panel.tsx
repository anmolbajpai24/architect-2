"use client";

import { useState } from "react";
import { ArrowLeft, FilePen, LoaderCircle, MessageSquare, ShieldCheck, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { ScenarioResult } from "@/domain/schemas";
import type { WorkspaceChange, WorkspaceSnapshot } from "@/server/workspace";
import { cn } from "@/lib/utils";
import { AssertionRow } from "./assertion-row";
import { modelLabel } from "./format";
import { ScenarioRevisionDiff } from "./scenario-revision-diff";
import type { WorkspaceApi } from "./use-workspace";

/**
 * "Change the rule": the focused composer for revising a Scenario that blocked a change. It never edits agents.
 * Draft → review the before/after → apply explicitly (or discard). Nothing changes until "Apply".
 */
export function RuleChangePanel({
  change,
  snapshot,
  failures,
  api,
  onBack,
}: {
  change: WorkspaceChange;
  snapshot: WorkspaceSnapshot;
  failures: ScenarioResult[];
  api: WorkspaceApi;
  onBack: () => void;
}) {
  const [scenarioKey, setScenarioKey] = useState(failures[0]?.scenarioKey ?? "");
  const [request, setRequest] = useState("");
  const scenario = snapshot.scenarios.find((s) => s.key === scenarioKey);
  const failure = failures.find((f) => f.scenarioKey === scenarioKey);
  const draft = scenario?.versions.find((v) => v.status === "proposed" && v.changeId === change.id);
  const drafting = api.busyLabel === "Drafting rule change";

  if (!scenario) return null;

  return (
    <div className="space-y-5 px-5 pb-8">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" /> Back to the verdict
      </button>

      <header className="space-y-1.5">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-indigo-600">Change the rule</div>
        <h3 className="text-base font-semibold leading-snug">Update the requirement because you changed your mind</h3>
        <p className="text-xs leading-relaxed text-muted-foreground">
          The scenario gets a new version that you review before it applies. The agents in this change stay exactly as
          proposed. Afterwards, the live agents and this change are both verified against the new rule.
        </p>
      </header>

      {failures.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {failures.map((f) => (
            <button
              key={f.scenarioKey}
              type="button"
              onClick={() => setScenarioKey(f.scenarioKey)}
              className={cn(
                "rounded-full border px-2.5 py-1 text-[11px]",
                f.scenarioKey === scenarioKey ? "border-foreground bg-foreground text-background" : "hover:bg-muted",
              )}
            >
              {f.name}
            </button>
          ))}
        </div>
      )}

      <section className="space-y-2.5 rounded-xl border p-3.5">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">{scenario.name}</span>
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-mono text-[10.5px] text-emerald-700">
            v{scenario.version} · live rule
          </span>
        </div>
        <div className="flex gap-2 rounded-lg bg-muted/50 p-2.5 text-xs leading-snug">
          <ShieldCheck className="size-4 shrink-0 text-muted-foreground" />
          <span>{scenario.intent}</span>
        </div>
        <div className="flex gap-2 text-xs text-muted-foreground">
          <MessageSquare className="mt-0.5 size-3.5 shrink-0" />
          <span>“{scenario.input.message}”</span>
        </div>
        {failure && (
          <div className="space-y-1">
            <div className="text-[11px] font-medium text-rose-700">What failed under this change</div>
            <div className="-mx-1 space-y-0.5">
              {failure.assertions
                .filter((r) => r.status === "fail" || r.status === "error")
                .map((r, i) => (
                  <AssertionRow key={i} assertion={r.assertion} result={r} />
                ))}
            </div>
          </div>
        )}
      </section>

      {!draft ? (
        <section className="space-y-2">
          <label htmlFor="rule-request" className="text-sm font-semibold">
            What should the rule be now?
          </label>
          <Textarea
            id="rule-request"
            value={request}
            onChange={(e) => setRequest(e.target.value)}
            placeholder="e.g. Allow recommendations up to $900 when nothing suitable exists under $600."
            className="min-h-20 text-sm"
          />
          {scenario.suggestedRuleChanges.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {scenario.suggestedRuleChanges.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setRequest(s)}
                  className="inline-flex items-center gap-1 rounded-full border bg-muted/50 px-2.5 py-1 text-left text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <Sparkles className="size-3 shrink-0" />
                  {s}
                </button>
              ))}
            </div>
          )}
          <Button
            className="w-full"
            variant="outline"
            disabled={api.busy || !request.trim()}
            onClick={() => api.draftRuleChange(change.id, scenario.key, request.trim())}
          >
            {drafting ? (
              <>
                <LoaderCircle data-icon="inline-start" className="animate-spin" /> Architect is drafting the new rule…
              </>
            ) : (
              <>
                <FilePen data-icon="inline-start" /> Draft rule change
              </>
            )}
          </Button>
          <p className="text-[11px] text-muted-foreground">
            Architect drafts a revised scenario using only the existing checks (tool, output, judge). If your requirement
            can&apos;t be expressed with them, it says so instead.
          </p>
        </section>
      ) : (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-semibold">Proposed rule</h4>
            <span className="rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 font-mono text-[10.5px] text-indigo-700">
              v{draft.version} · draft, not applied
            </span>
          </div>
          {draft.request && (
            <p className="rounded-lg border-l-2 border-indigo-300 bg-indigo-50/50 px-3 py-2 text-xs italic leading-relaxed">
              You asked: “{draft.request}”
            </p>
          )}
          {draft.proposal && (
            <div className="flex gap-2.5 rounded-xl border bg-muted/40 p-3">
              <div className="flex size-6 shrink-0 items-center justify-center rounded-md bg-foreground text-background">
                <Sparkles className="size-3.5" />
              </div>
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center gap-2 text-xs font-medium">
                  Architect
                  <span className="rounded border bg-background px-1.5 font-mono text-[10px] font-normal text-muted-foreground">
                    {draft.proposal.mode === "live" ? modelLabel(draft.proposal.model) : "fixture proposer"}
                  </span>
                </div>
                <p className="text-xs leading-relaxed">{draft.proposal.rationale}</p>
              </div>
            </div>
          )}
          <ScenarioRevisionDiff before={scenario} after={draft} />
          <p className="text-[11px] text-muted-foreground">
            Until you apply it, the live rule stays v{scenario.version}. Applying it checks the new rule&apos;s structure,
            makes it live, then runs it against the live agents and re-verifies this change.
          </p>
          <div className="flex gap-2">
            <Button
              className="flex-1"
              disabled={api.busy}
              onClick={async () => {
                if (await api.applyRuleChange(draft.id)) onBack();
              }}
            >
              <ShieldCheck data-icon="inline-start" /> Apply new rule &amp; re-verify
            </Button>
            <Button variant="ghost" disabled={api.busy} onClick={() => api.discardRuleChange(draft.id)}>
              <Trash2 data-icon="inline-start" /> Discard
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
