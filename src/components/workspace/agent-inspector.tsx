import { Bot, GitPullRequestArrow } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { WorkspaceAgent, WorkspaceSnapshot, WorkspaceVersion } from "@/server/workspace";
import { modelLabel, shortId } from "./format";
import { RelativeTime } from "./relative-time";
import { InstructionDiff } from "./instruction-diff";
import { ChangeStatusPill, VersionPill } from "./status";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[88px_1fr] gap-2 text-xs">
      <div className="text-muted-foreground">{label}</div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function schemaType(prop: { type?: string | string[]; items?: { type?: string } }) {
  const types = [prop.type].flat().filter(Boolean) as string[];
  return types.map((t) => (t === "array" ? `${prop.items?.type ?? "any"}[]` : t)).join(" | ");
}

function VersionCard({
  agent,
  version,
  snapshot,
  onOpenChange,
}: {
  agent: WorkspaceAgent;
  version: WorkspaceVersion;
  snapshot: WorkspaceSnapshot;
  onOpenChange: (id: string) => void;
}) {
  const change = snapshot.changes.find((c) => c.id === version.changeId);
  const baseId = change?.baseVersionIds[agent.key];
  const base = agent.versions.find((v) => v.id === baseId);
  return (
    <div className="rounded-xl border bg-background p-3">
      <div className="flex items-center gap-2">
        <VersionPill version={version.version} status={version.status} />
        <RelativeTime iso={version.createdAt} className="ml-auto text-[11px] text-muted-foreground" />
      </div>
      {change ? (
        <button
          type="button"
          onClick={() => onOpenChange(change.id)}
          className="mt-2 flex w-full items-start gap-2 rounded-lg bg-muted/50 p-2 text-left text-xs transition-colors hover:bg-muted"
        >
          <GitPullRequestArrow className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 leading-snug">
            <span className="font-mono text-muted-foreground">#{shortId(change.id)}</span> “{change.intent}”
          </span>
          <ChangeStatusPill status={change.status} resolved={Boolean(change.resolution)} />
        </button>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">Seeded baseline.</p>
      )}
      {base && (
        <details className="group mt-2">
          <summary className="cursor-pointer list-none text-[11px] font-medium text-muted-foreground hover:text-foreground">
            <span className="inline-block transition-transform group-open:rotate-90">›</span> Instructions vs v{base.version}
          </summary>
          <InstructionDiff className="mt-2" before={base.config.instructions} after={version.config.instructions} />
        </details>
      )}
    </div>
  );
}

export function AgentInspector({
  agent,
  snapshot,
  onOpenChange,
}: {
  agent: WorkspaceAgent;
  snapshot: WorkspaceSnapshot;
  onOpenChange: (id: string) => void;
}) {
  const live = agent.versions.find((v) => v.status === "live") ?? agent.versions[0];
  const { config } = live;
  const name = (key: string) => snapshot.agents.find((a) => a.key === key)?.name ?? key;
  // jsonb doesn't keep key order; the schema's `required` list does.
  const schemaProps = config.outputSchema.properties as Record<string, { type?: string | string[] }>;
  const order = (config.outputSchema.required as string[] | undefined) ?? Object.keys(schemaProps);
  const properties = order.filter((k) => schemaProps[k]).map((k) => [k, schemaProps[k]] as const);

  return (
    <div className="space-y-4">
      <header className="flex items-start gap-2.5">
        <div className="flex size-8 items-center justify-center rounded-lg bg-muted">
          <Bot className="size-4 text-muted-foreground" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-semibold leading-tight">{agent.name}</h3>
            <VersionPill version={live.version} status="live" />
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">{agent.role}</p>
        </div>
      </header>

      <Tabs defaultValue="config">
        <TabsList>
          <TabsTrigger value="config">Configuration</TabsTrigger>
          <TabsTrigger value="versions">Versions ({agent.versions.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="config" className="mt-3 space-y-4">
          <div className="space-y-2 rounded-xl border bg-background p-3">
            <Field label="Model">
              <span className="font-mono">{modelLabel(config.model)}</span>
              <span className="ml-1.5 text-muted-foreground">({config.model.split(":")[0]})</span>
            </Field>
            <Field label="Tools">
              {config.tools.length ? <span className="font-mono">{config.tools.join(", ")}</span> : "—"}
            </Field>
            <Field label="Hands off to">{config.handoffs.length ? config.handoffs.map(name).join(" → ") : "—"}</Field>
            <Field label="Output">
              <div className="flex flex-wrap gap-1">
                {properties.map(([key, prop]) => (
                  <span key={key} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10.5px]">
                    {key}: <span className="text-muted-foreground">{schemaType(prop)}</span>
                  </span>
                ))}
              </div>
            </Field>
          </div>
          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Instructions</h4>
            <pre className="whitespace-pre-wrap rounded-xl border bg-muted/40 p-3 font-mono text-[11.5px] leading-relaxed">
              {config.instructions}
            </pre>
          </div>
        </TabsContent>

        <TabsContent value="versions" className="mt-3 space-y-2">
          <p className="text-[11px] text-muted-foreground">
            Versions are immutable. A change creates a new version; only verified changes go live.
          </p>
          {agent.versions.map((v) => (
            <VersionCard key={v.id} agent={agent} version={v} snapshot={snapshot} onOpenChange={onOpenChange} />
          ))}
        </TabsContent>
      </Tabs>
    </div>
  );
}
