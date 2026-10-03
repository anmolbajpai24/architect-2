"use client";

import { useState } from "react";
import { ArrowRight, CornerDownRight, GitPullRequestArrow, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { WorkspaceChange, WorkspaceEvent, WorkspaceSnapshot } from "@/server/workspace";
import { cn } from "@/lib/utils";
import { describeEvent, shortId } from "./format";
import { RelativeTime } from "./relative-time";
import { ChangeStatusPill } from "./status";

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
  onPropose,
}: {
  suggestions: string[];
  disabled: boolean;
  onPropose: (intent: string) => Promise<boolean>;
}) {
  const [intent, setIntent] = useState("");
  const submit = async () => {
    if (!intent.trim() || disabled) return;
    if (await onPropose(intent.trim())) setIntent("");
  };
  return (
    <div className="rounded-xl border bg-background p-3 shadow-xs">
      <Textarea
        value={intent}
        onChange={(e) => setIntent(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
        }}
        placeholder="Describe how the agents should change…"
        className="min-h-16 resize-none border-0 p-0 text-sm shadow-none focus-visible:ring-0"
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
          Propose change
          <ArrowRight data-icon="inline-end" />
        </Button>
      </div>
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
        <ChangeStatusPill status={change.status} resolved={Boolean(change.resolution)} />
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

export function ChangesPanel({
  snapshot,
  events,
  busy,
  openChangeId,
  onPropose,
  onOpenChange,
}: {
  snapshot: WorkspaceSnapshot;
  events: WorkspaceEvent[];
  busy: boolean;
  openChangeId: string | null;
  onPropose: (intent: string) => Promise<boolean>;
  onOpenChange: (id: string) => void;
}) {
  return (
    <div className="flex flex-col gap-5">
      <Composer suggestions={snapshot.suggestedIntents} disabled={busy} onPropose={onPropose} />

      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Changes</h3>
        {snapshot.changes.length === 0 ? (
          <p className="rounded-xl border border-dashed p-4 text-center text-xs text-muted-foreground">
            No changes yet. Every change is verified against the scenarios before it can go live.
          </p>
        ) : (
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
        )}
      </section>

      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Activity</h3>
        <Activity events={events} snapshot={snapshot} />
      </section>
    </div>
  );
}
