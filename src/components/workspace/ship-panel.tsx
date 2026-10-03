"use client";

import { useState } from "react";
import { ExternalLink, GitBranch, GitCommitHorizontal, GitPullRequest, LoaderCircle, ShieldAlert, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { WorkspaceChange, WorkspaceRun, WorkspaceSnapshot } from "@/server/workspace";
import { cn } from "@/lib/utils";
import type { WorkspaceApi } from "./use-workspace";

function Row({ icon: Icon, label, children }: { icon: typeof GitBranch; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <Icon className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="w-16 shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </div>
  );
}

const PROTOTYPE_NOTE =
  "Prototype representation: the pull request commits the verified agent and scenario definitions as JSON, plus the change's verification record. Architect doesn't generate application code yet.";

/**
 * The last step of a change's lifecycle: ship the verified, applied change to GitHub as a pull request. The server
 * enforces the gate; this panel only reflects it (and the recorded GitHub provenance).
 */
export function ShipPanel({
  change,
  snapshot,
  run,
  api,
}: {
  change: WorkspaceChange;
  snapshot: WorkspaceSnapshot;
  run: WorkspaceRun | undefined;
  api: WorkspaceApi;
}) {
  const { github } = snapshot.env;
  const shipment = change.shipment;
  const [repository, setRepository] = useState(github.repositories[0] ?? "");
  const results = run?.results ?? [];
  const passing = results.filter((r) => r.status === "pass").length;
  const shipping = api.busyLabel === "Shipping to GitHub" || shipment?.status === "shipping";

  if (shipment?.status === "shipped") {
    return (
      <div className="space-y-2.5 rounded-xl border border-emerald-200 bg-emerald-50/40 p-3.5">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700">GitHub</div>
        <div className="space-y-1.5 rounded-lg bg-background p-2.5">
          <Row icon={ShieldCheck} label="Verified">
            {passing}/{results.length} scenarios passing
          </Row>
          <Row icon={GitPullRequest} label="PR">
            <span className="font-medium">#{shipment.prNumber}</span> <span className="text-muted-foreground">· {shipment.repository}</span>
          </Row>
          <Row icon={GitBranch} label="Branch">
            <span className="font-mono text-[11px]" title={shipment.branch}>
              {shipment.branch}
            </span>
          </Row>
          {shipment.commitSha && (
            <Row icon={GitCommitHorizontal} label="Commit">
              <span className="font-mono text-[11px]">{shipment.commitSha.slice(0, 7)}</span>
            </Row>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground">
          Status: pull request open for review into <span className="font-mono">{shipment.baseBranch ?? "the default branch"}</span>. Merging it is
          up to you on GitHub.
        </p>
        {shipment.prUrl && (
          <Button asChild className="w-full">
            <a href={shipment.prUrl} target="_blank" rel="noreferrer">
              <ExternalLink data-icon="inline-start" /> Open PR #{shipment.prNumber}
            </a>
          </Button>
        )}
      </div>
    );
  }

  const ready = Boolean(change.ship?.ready);
  const canShip = ready && github.configured && !shipping && !api.busy;
  return (
    <div className="space-y-3">
      <div
        className={cn(
          "rounded-xl border p-3.5",
          ready ? "border-emerald-200 bg-emerald-50/40" : "border-amber-200 bg-amber-50/50",
        )}
      >
        <div className={cn("flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider", ready ? "text-emerald-700" : "text-amber-700")}>
          {ready ? <ShieldCheck className="size-3.5" /> : <ShieldAlert className="size-3.5" />}
          {ready ? "Verified · ready to ship" : "Not ready to ship"}
        </div>
        <div className="mt-1 text-sm font-semibold">
          {passing}/{results.length} scenarios passing
        </div>
        {!ready && change.ship?.reason && <p className="mt-1 text-xs leading-relaxed text-amber-900">{change.ship.reason}</p>}
      </div>

      {shipment?.status === "failed" && (
        <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs leading-relaxed text-rose-900">
          <div className="font-semibold">The last attempt to ship failed</div>
          <p className="mt-0.5">{shipment.error}</p>
          <p className="mt-1 text-rose-700/80">Retrying reuses the branch and any commit already made; it won&apos;t open a duplicate pull request.</p>
        </div>
      )}

      {github.configured ? (
        github.repositories.length > 1 ? (
          <label className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">Repository</span>
            <select
              value={repository}
              onChange={(e) => setRepository(e.target.value)}
              disabled={shipping}
              className="min-w-0 flex-1 rounded-md border bg-background px-2 py-1 font-mono text-xs"
            >
              {github.repositories.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <div className="text-xs text-muted-foreground">
            Repository <span className="font-mono text-foreground">{repository}</span>
          </div>
        )
      ) : (
        <div className="rounded-xl border border-dashed p-3 text-xs leading-relaxed text-muted-foreground">
          GitHub isn&apos;t connected on this server ({github.problems.join("; ")}). Set <span className="font-mono">ARCHITECT_GITHUB_TOKEN</span>{" "}
          and <span className="font-mono">ARCHITECT_GITHUB_REPOS</span> in <span className="font-mono">.env</span> and restart. The credential stays
          on the server.
        </div>
      )}

      <Button className="w-full" disabled={!canShip} onClick={() => api.shipChange(change.id, repository)}>
        {shipping ? <LoaderCircle data-icon="inline-start" className="animate-spin" /> : <GitPullRequest data-icon="inline-start" />}
        {shipping ? "Creating branch, commit and pull request…" : shipment?.status === "failed" ? "Retry ship to GitHub" : "Ship to GitHub"}
      </Button>
      <p className="text-[11px] leading-relaxed text-muted-foreground">{PROTOTYPE_NOTE}</p>
    </div>
  );
}
