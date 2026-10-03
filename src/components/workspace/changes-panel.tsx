"use client";

import { useState } from "react";
import { ArrowRight, CornerDownRight, GitPullRequest, GitPullRequestArrow, LoaderCircle, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { WorkspaceChange, WorkspaceEvent, WorkspaceSnapshot } from "@/server/workspace";
import { cn } from "@/lib/utils";
import { describeEvent, modelLabel, shortId } from "./format";
import { RelativeTime } from "./relative-time";
import { ChangeStatusPill } from "./status";
import type { Protection } from "./use-workspace";

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
  disabled,
  drafting,
  proposerLabel,
  onPropose,
}: {
  suggestions: string[];
  disabled: boolean;
  drafting: boolean;
  proposerLabel: string;
  onPropose: (intent: string) => Promise<boolean>;
}) {
  const [intent, setIntent] = useState("");
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
        placeholder="e.g. Make the Recommendation Agent more confident."
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
 * protected and what currently holds, then hands over to Ask Architect.
 */
function WorkflowIntro({ protection }: { protection: Protection }) {
  const { total, passing, failing, notRun } = protection;
  return (
    <div className="space-y-1.5">
      <p className="text-[15px] font-medium leading-snug">
        You have {total} scenario{total === 1 ? "" : "s"} protecting this app.
      </p>
      <p
        className={cn(
          "text-sm",
          failing > 0 ? "text-rose-700" : notRun ? "text-muted-foreground" : "text-emerald-700",
        )}
      >
        {notRun
          ? "None have been verified yet — run them to see where the agents stand."
          : failing > 0
            ? `${failing} of ${total} currently fail.`
            : `All ${total} currently pass.`}
      </p>
      <p className="pt-1 text-sm text-muted-foreground">
        Describe a change and Architect verifies it against every one of them before anything goes live.
      </p>
    </div>
  );
}

export function ChangesPanel({
  snapshot,
  events,
  protection,
  busy,
  drafting,
  openChangeId,
  onPropose,
  onOpenChange,
}: {
  snapshot: WorkspaceSnapshot;
  events: WorkspaceEvent[];
  protection: Protection;
  busy: boolean;
  drafting: boolean;
  openChangeId: string | null;
  onPropose: (intent: string) => Promise<boolean>;
  onOpenChange: (id: string) => void;
}) {
  const noChanges = snapshot.changes.length === 0;
  return (
    <div className="flex flex-col gap-5">
      {noChanges && <WorkflowIntro protection={protection} />}

      <Composer
        suggestions={snapshot.suggestedIntents}
        disabled={busy}
        drafting={drafting}
        proposerLabel={snapshot.env.proposer.mode === "live" ? modelLabel(snapshot.env.proposer.model) : "the recorded demo proposer"}
        onPropose={onPropose}
      />

      {!noChanges && (
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Changes</h3>
          <div className="flex flex-col gap-2">
            {snapshot.changes.map((c) => (
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
