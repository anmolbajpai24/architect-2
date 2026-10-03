"use client";

import { useState } from "react";
import { ArrowRight, CornerDownRight, GitPullRequest, GitPullRequestArrow, LoaderCircle, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { WorkspaceChange, WorkspaceEvent, WorkspaceSnapshot } from "@/server/workspace";
import { cn } from "@/lib/utils";
import { ActiveChange } from "./active-change";
import { describeEvent, modelLabel, shortId } from "./format";
import { RelativeTime } from "./relative-time";
import { ChangeStatusPill } from "./status";
import type { Progress, Protection } from "./use-workspace";

export function versionNumber(snapshot: WorkspaceSnapshot, versionId: string | undefined) {
  for (const a of snapshot.agents) {
    const v = a.versions.find((x) => x.id === versionId);
    if (v) return v.version;
  }
  return undefined;
}

export function agentName(snapshot: WorkspaceSnapshot, key: string) {
  return snapshot.agents.find((a) => a.key === key)?.name ?? key;
}

function Composer({
  suggestions,
  placeholder,
  disabled,
  drafting,
  proposerLabel,
  onPropose,
  initialPrompt,
}: {
  suggestions: string[];
  placeholder: string | null;
  disabled: boolean;
  drafting: boolean;
  proposerLabel: string;
  onPropose: (intent: string) => Promise<boolean>;
  initialPrompt?: string | null;
}) {
  const [intent, setIntent] = useState(initialPrompt ?? "");
  const submit = async () => {
    if (!intent.trim() || disabled) return;
    if (await onPropose(intent.trim())) setIntent("");
  };
  return (
    <div className="rounded-xl border bg-background p-3 shadow-xs">
      <label htmlFor="ask-architect" className="text-sm font-semibold">
        What should change?
      </label>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Ask Architect to change behavior, agents, or requirements.
      </p>
      <Textarea
        id="ask-architect"
        value={intent}
        onChange={(e) => setIntent(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
        }}
        placeholder={placeholder ?? "e.g. Make one of the agents more concise."}
        className="mt-2.5 min-h-14 resize-none border-0 p-0 text-sm shadow-none focus-visible:ring-0"
      />
      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap gap-1.5">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setIntent(s)}
              className="inline-flex max-w-full items-center gap-1 truncate rounded-full border bg-muted/50 px-2.5 py-1 text-left text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Sparkles className="size-3 shrink-0" />
              <span className="truncate">{s}</span>
            </button>
          ))}
        </div>
        <Button size="sm" onClick={submit} disabled={disabled || !intent.trim()}>
          {drafting ? (
            <>
              <LoaderCircle data-icon="inline-start" className="animate-spin" /> Drafting…
            </>
          ) : (
            <>
              Propose change
              <ArrowRight data-icon="inline-end" />
            </>
          )}
        </Button>
      </div>
      {drafting && (
        <p className="mt-2 border-t pt-2 text-[11px] text-muted-foreground">
          Architect is drafting edits with {proposerLabel}. They will be verified against every scenario before anything
          goes live.
        </p>
      )}
    </div>
  );
}

function ChangeCard({
  change,
  snapshot,
  selected,
  onOpen,
}: {
  change: WorkspaceChange;
  snapshot: WorkspaceSnapshot;
  selected: boolean;
  onOpen: () => void;
}) {
  const transitions = Object.entries(change.proposedVersionIds).map(([key, id]) => ({
    key,
    from: versionNumber(snapshot, change.baseVersionIds[key]),
    to: versionNumber(snapshot, id),
  }));
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "w-full rounded-xl border bg-background p-3 text-left transition-all hover:shadow-sm",
        selected && "ring-2 ring-foreground/80 ring-offset-1",
      )}
    >
      <div className="flex items-center gap-2">
        <GitPullRequestArrow className="size-3.5 text-muted-foreground" />
        <span className="font-mono text-[11px] text-muted-foreground">#{shortId(change.id)}</span>
        <ChangeStatusPill status={change.status} resolution={change.resolution} />
        {change.shipment?.status === "shipped" && (
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
            <GitPullRequest className="size-3" /> PR #{change.shipment.prNumber}
          </span>
        )}
        <RelativeTime iso={change.createdAt} className="ml-auto text-[11px] text-muted-foreground" />
      </div>
      <p className="mt-2 text-[13px] leading-snug">“{change.intent}”</p>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        {transitions.map((t) => (
          <span key={t.key}>
            {agentName(snapshot, t.key)} <span className="font-mono">v{t.from}</span> →{" "}
            <span className="font-mono">v{t.to}</span>
          </span>
        ))}
        {change.parentChangeId && (
          <span className="inline-flex items-center gap-1">
            <CornerDownRight className="size-3" />
            revises #{shortId(change.parentChangeId)}
          </span>
        )}
      </div>
    </button>
  );
}

const eventTone = {
  default: "bg-foreground/70",
  good: "bg-emerald-500",
  bad: "bg-rose-500",
  muted: "bg-muted-foreground/40",
};

function Activity({ events, snapshot }: { events: WorkspaceEvent[]; snapshot: WorkspaceSnapshot }) {
  const items = events
    .map((e) => ({ e, d: describeEvent(e, snapshot) }))
    .filter((x): x is { e: WorkspaceEvent; d: NonNullable<ReturnType<typeof describeEvent>> } => x.d !== null)
    .reverse()
    .slice(0, 30);
  return (
    <ol className="relative ml-1 space-y-2.5 border-l pl-4">
      {items.map(({ e, d }) => (
        <li key={e.seq} className="relative text-xs leading-snug">
          <span className={cn("absolute top-1.5 -left-[19.5px] size-2 rounded-full ring-2 ring-background", eventTone[d.tone])} />
          <span className={cn(d.tone === "muted" && "text-muted-foreground")}>{d.text}</span>
          <RelativeTime iso={e.createdAt} className="ml-2 text-[10px] text-muted-foreground" />
        </li>
      ))}
    </ol>
  );
}

/**
 * What the workspace says before any change exists: the workflow itself, not a dashboard. It states what is
 * protected, then hands over to Ask Architect.
 */
function WorkflowIntro({ total }: { total: number }) {
  return (
    <div className="space-y-1.5">
      <p className="text-[15px] font-medium leading-snug">
        You have {total} scenario{total === 1 ? "" : "s"} protecting this app.
      </p>
      <p className="text-sm text-muted-foreground">
        Describe a change and Architect verifies it against every one of them before anything goes live.
      </p>
    </div>
  );
}

/**
 * Where the live agents stand, once they have been run and before any change is in flight. Subordinate to the
 * composer: the verdict belongs to the scenarios, and the scenarios are one click away.
 */
function RunSummary({ protection, onViewScenario }: { protection: Protection; onViewScenario: () => void }) {
  const { total, passing, failing, notRun } = protection;
  return (
    <section className="rounded-xl border bg-background p-3">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Verification</div>
      <p
        className={cn(
          "mt-1 text-sm font-medium",
          notRun ? "text-muted-foreground" : failing > 0 ? "text-rose-700" : "text-emerald-700",
        )}
      >
        {notRun ? "Not run yet" : `${passing}/${total} scenarios passing`}
      </p>
      <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
        {notRun
          ? "Run the scenarios to see how the live agents behave right now."
          : failing > 0
            ? "The live agents don't meet every behavior you protect."
            : "All protected behaviors currently hold."}
      </p>
      <button
        type="button"
        onClick={onViewScenario}
        className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        View scenarios <ArrowRight className="size-3" />
      </button>
    </section>
  );
}

/**
 * The center column: the user's current task. Before any change it is the workflow and the composer; once a
 * change exists the newest one leads, because that is what Architect is evaluating right now. Earlier changes
 * stay below as history.
 */
export function ChangesPanel({
  snapshot,
  events,
  protection,
  progress,
  busy,
  drafting,
  openChangeId,
  onPropose,
  onOpenChange,
  onViewScenario,
  initialPrompt,
}: {
  snapshot: WorkspaceSnapshot;
  events: WorkspaceEvent[];
  protection: Protection;
  progress: Progress | null;
  busy: boolean;
  drafting: boolean;
  openChangeId: string | null;
  onPropose: (intent: string) => Promise<boolean>;
  onOpenChange: (id: string) => void;
  onViewScenario: () => void;
  initialPrompt?: string | null;
}) {
  const [active, ...earlier] = snapshot.changes; // newest first
  return (
    <div className="flex flex-col gap-5">
      {initialPrompt && (
        <div className="rounded-xl border border-dashed bg-muted/30 p-3 text-xs leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground">Brief loaded.</span> This prototype carries it into the existing
          Architect change workflow. Arbitrary project definitions are not persisted yet, so Laptop Advisor remains the
          seeded reference workspace.
        </div>
      )}
      {active ? (
        <ActiveChange change={active} snapshot={snapshot} progress={progress} onOpen={onOpenChange} />
      ) : (
        <WorkflowIntro total={protection.total} />
      )}

      <Composer
        suggestions={snapshot.suggestedIntents}
        placeholder={snapshot.project.placeholders.changeRequest}
        disabled={busy}
        drafting={drafting}
        proposerLabel={snapshot.env.proposer.mode === "live" ? modelLabel(snapshot.env.proposer.model) : "the recorded demo proposer"}
        onPropose={onPropose}
        initialPrompt={initialPrompt}
      />

      {!active && <RunSummary protection={protection} onViewScenario={onViewScenario} />}

      {earlier.length > 0 && (
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Earlier changes
          </h3>
          <div className="flex flex-col gap-2">
            {earlier.map((c) => (
              <ChangeCard
                key={c.id}
                change={c}
                snapshot={snapshot}
                selected={openChangeId === c.id}
                onOpen={() => onOpenChange(c.id)}
              />
            ))}
          </div>
        </section>
      )}

      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Activity</h3>
        <Activity events={events} snapshot={snapshot} />
      </section>
    </div>
  );
}
