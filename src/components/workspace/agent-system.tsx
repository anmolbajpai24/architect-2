import { Bot, CornerDownRight, Wrench } from "lucide-react";
import type { WorkspaceAgent } from "@/server/workspace";
import { cn } from "@/lib/utils";
import { modelLabel } from "./format";
import { VersionPill } from "./status";

/** The agent system as a handoff chain: entry agent first, then its handoffs in execution order. */
export function AgentSystem({
  agents,
  selectedKey,
  onSelect,
}: {
  agents: WorkspaceAgent[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
}) {
  const entry = agents.find((a) => a.entry);
  const live = (a: WorkspaceAgent) => a.versions.find((v) => v.status === "live") ?? a.versions[0];
  const order = entry ? live(entry).config.handoffs : [];
  const handoffs = order.map((k) => agents.find((a) => a.key === k)).filter((a): a is WorkspaceAgent => Boolean(a));
  const rest = agents.filter((a) => a !== entry && !handoffs.includes(a));

  const card = (agent: WorkspaceAgent, step?: number) => {
    const current = live(agent);
    const pending = agent.versions.find((v) => v.status === "proposed" || v.status === "verified");
    return (
      <button
        key={agent.key}
        type="button"
        onClick={() => onSelect(agent.key)}
        className={cn(
          "w-full rounded-xl border bg-background p-3 text-left transition-all hover:shadow-sm",
          selectedKey === agent.key && "ring-2 ring-foreground/80 ring-offset-1",
        )}
      >
        <div className="flex items-center gap-2">
          <div className="flex size-6 items-center justify-center rounded-md bg-muted">
            <Bot className="size-3.5 text-muted-foreground" />
          </div>
          <span className="flex-1 truncate text-[13px] font-medium">{agent.name}</span>
          <VersionPill version={current.version} />
        </div>
        <p className="mt-1.5 line-clamp-2 text-xs leading-snug text-muted-foreground">{agent.role}</p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {step !== undefined && (
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              handoff {step}
            </span>
          )}
          {agent.entry && (
            <span className="rounded bg-foreground px-1.5 py-0.5 text-[10px] font-medium text-background">entry</span>
          )}
          {current.config.tools.map((t) => (
            <span key={t} className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">
              <Wrench className="size-2.5" />
              {t}
            </span>
          ))}
          <span className="truncate font-mono text-[10px] text-muted-foreground">{modelLabel(current.config.model)}</span>
        </div>
        {pending && (
          <div
            className={cn(
              "mt-2 rounded-md px-2 py-1 text-[11px]",
              pending.status === "verified" ? "bg-emerald-50 text-emerald-700" : "bg-sky-50 text-sky-700",
            )}
          >
            {pending.status === "verified"
              ? `v${pending.version} verified, ready to apply`
              : `v${pending.version} proposed, verifying`}
          </div>
        )}
      </button>
    );
  };

  return (
    <div className="flex flex-col gap-2">
      {entry && card(entry)}
      {handoffs.map((a, i) => (
        <div key={a.key} className="flex gap-1.5">
          <CornerDownRight className="mt-3 size-4 shrink-0 text-muted-foreground/60" />
          <div className="min-w-0 flex-1">{card(a, i + 1)}</div>
        </div>
      ))}
      {rest.map((a) => card(a))}
    </div>
  );
}
