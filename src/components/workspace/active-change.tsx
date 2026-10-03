"use client";

import { ArrowRight, CircleCheck, CircleDashed, CircleX, ExternalLink, GitPullRequest, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { WorkspaceChange, WorkspaceSnapshot } from "@/server/workspace";
import { cn } from "@/lib/utils";
import { agentName, versionNumber } from "./changes-panel";
import { shortId } from "./format";
import type { Progress } from "./use-workspace";

/**
 * The center column while a change is in flight: what Architect is evaluating right now, how far it got, and the
 * one thing to do next. It is deliberately a summary — the Verdict drawer stays the place where the entry
 * agent's response, the expected/actual pairs, the assertions and the resolution choices live.
 */

type Tone = "running" | "good" | "bad" | "rule";

const toneCard: Record<Tone, string> = {
  running: "border-sky-200 bg-sky-50/40",
  good: "border-emerald-200 bg-emerald-50/50",
  bad: "border-rose-300 bg-rose-50/60",
  rule: "border-indigo-200 bg-indigo-50/40",
};

const toneEyebrow: Record<Tone, string> = {
  running: "text-sky-700",
  good: "text-emerald-700",
  bad: "text-rose-700",
  rule: "text-indigo-600",
};

/** One line of the verification ledger: the check, and where it currently stands. */
function CheckRow({ label, state, value }: { label: string; state: "pass" | "fail" | "pending" | "running"; value: string }) {
  const Icon = state === "pass" ? CircleCheck : state === "fail" ? CircleX : state === "running" ? LoaderCircle : CircleDashed;
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-24 shrink-0 text-muted-foreground">{label}</span>
      <Icon
        className={cn(
          "size-3.5 shrink-0",
          state === "pass" && "text-emerald-600",
          state === "fail" && "text-rose-600",
          state === "running" && "animate-spin text-sky-600",
          state === "pending" && "text-muted-foreground",
        )}
      />
      <span
        className={cn(
          "font-medium",
          state === "pass" && "text-emerald-800",
          state === "fail" && "text-rose-800",
          state === "pending" && "text-muted-foreground",
        )}
      >
        {value}
      </span>
    </div>
  );
}

export function ActiveChange({
  change,
  snapshot,
  progress,
  onOpen,
}: {
  change: WorkspaceChange;
  snapshot: WorkspaceSnapshot;
  progress: Progress | null;
  onOpen: (id: string) => void;
}) {
  const live = progress && progress.changeId === change.id && !progress.finished ? progress : null;
  const run = snapshot.runs.find((r) => r.changeId === change.id);
  const results = run?.results ?? [];
  const passing = results.filter((r) => r.status === "pass").length;
  const failing = results.filter((r) => r.status !== "pass").length;
  const total = snapshot.scenarios.length;
  const structuralOk = change.structural ? change.structural.every((c) => c.ok) : null;
  const shipment = change.shipment;
  // A drafted-but-unapplied rule revision means the user is mid "Change the rule" and owes it a review.
  const ruleDraft = snapshot.scenarios
    .flatMap((s) => s.versions)
    .find((v) => v.status === "proposed" && v.changeId === change.id);
  const child = snapshot.changes.find((c) => c.parentChangeId === change.id);
  const broke = results.filter((r) => r.status !== "pass").map((r) => r.name);
  const brokeNames = broke.slice(0, 2).join(" · ") + (broke.length > 2 ? ` +${broke.length - 2} more` : "");

  const transitions = Object.entries(change.proposedVersionIds).map(([key, id]) => ({
    key,
    from: versionNumber(snapshot, change.baseVersionIds[key]),
    to: versionNumber(snapshot, id),
  }));

  const stage = ((): {
    tone: Tone;
    eyebrow: string;
    headline: string;
    body: string;
    action: { label: string; onClick: () => void; variant?: "default" | "outline" };
    hint?: string;
  } => {
    if (shipment?.status === "shipped") {
      return {
        tone: "good",
        eyebrow: "Shipped",
        headline: `Pull request #${shipment.prNumber} on ${shipment.repository}`,
        body: "The verified definitions are open for review on GitHub. Merging is up to you there.",
        action: { label: "Review change", onClick: () => onOpen(change.id), variant: "outline" },
      };
    }
    switch (change.status) {
      case "proposed":
        return {
          tone: "running",
          eyebrow: "Verifying",
          headline: live
            ? `Running scenarios · ${Object.values(live.scenarios).filter((s) => s !== "running").length}/${total} done`
            : structuralOk === null
              ? "Checking the configuration…"
              : "Running every scenario against the proposed versions…",
          body: "Nothing goes live until this change is verified and you apply it.",
          action: { label: "Follow the verdict", onClick: () => onOpen(change.id), variant: "outline" },
        };
      case "structural_failed":
        return {
          tone: "bad",
          eyebrow: "Configuration invalid",
          headline: "The proposed configuration doesn't hold together",
          body: "It was never run against the scenarios, so its behavior is unknown.",
          action: { label: "Review verdict", onClick: () => onOpen(change.id) },
        };
      case "behavioral_failed":
        if (ruleDraft)
          return {
            tone: "rule",
            eyebrow: "Rule change drafted",
            headline: `A new version of the rule (v${ruleDraft.version}) is waiting for your review`,
            body: "The live rule is unchanged until you apply it. The agents in this change stay as proposed.",
            action: { label: "Review rule change", onClick: () => onOpen(change.id) },
          };
        if (change.resolution === "keep_rule_fix" && child)
          return {
            tone: "rule",
            eyebrow: "Keeping the rule",
            headline: "Architect drafted a fix that satisfies the requirement",
            body: "The fix is a new change, verified from scratch before anything goes live.",
            action: { label: `Open the fix #${shortId(child.id)}`, onClick: () => onOpen(child.id) },
          };
        return {
          tone: "bad",
          eyebrow: "Behavior broken",
          // Name what broke; the ledger above already carries the count.
          headline: brokeNames || `${failing} scenario${failing === 1 ? "" : "s"} failing`,
          body: "Application behavior has changed. Decide whether the agent is wrong or the requirement is.",
          action: { label: "Review verdict", onClick: () => onOpen(change.id) },
        };
      case "verified":
        return {
          tone: "good",
          eyebrow: "Verified",
          headline: "Every protected behavior still holds",
          body: "This change is ready to apply. Nothing is live until you do.",
          action: { label: "Review change", onClick: () => onOpen(change.id) },
        };
      case "applied": {
        if (!change.ship?.ready)
          return {
            tone: "good",
            eyebrow: "Applied",
            headline: "Not ready to ship yet",
            body: change.ship?.reason ?? "The live agents are on the versions above.",
            action: { label: "Review change", onClick: () => onOpen(change.id), variant: "outline" },
          };
        return snapshot.env.github.configured
          ? {
              tone: "good",
              eyebrow: "Applied",
              headline: "Ready to ship to GitHub",
              body: "Architect opens a pull request with the verified agent and scenario definitions.",
              action: { label: "Ship to GitHub", onClick: () => onOpen(change.id) },
              hint: "Opens this change, where you confirm the repository and open the pull request.",
            }
          : {
              tone: "good",
              eyebrow: "Applied",
              headline: "Live and verified",
              body: "Connect GitHub to open this change as a pull request.",
              action: { label: "Review change", onClick: () => onOpen(change.id), variant: "outline" },
            };
      }
    }
  })();

  const behavior: { state: "pass" | "fail" | "pending" | "running"; value: string } =
    structuralOk === false
      ? { state: "pending", value: "Not checked" }
      : live
        ? { state: "running", value: "Running…" }
        : change.status === "behavioral_failed"
          ? { state: "fail", value: `${failing} of ${results.length} scenarios failing` }
          : change.status === "verified" || change.status === "applied"
            ? { state: "pass", value: `${passing}/${results.length} scenarios passing` }
            : { state: "pending", value: "Waiting to run" };

  return (
    <section className={cn("space-y-3 rounded-xl border p-3.5", toneCard[stage.tone])}>
      <div className="flex items-center gap-2">
        <span className={cn("text-[10px] font-semibold uppercase tracking-wider", toneEyebrow[stage.tone])}>
          {stage.eyebrow}
        </span>
        <span className="ml-auto font-mono text-[11px] text-muted-foreground">#{shortId(change.id)}</span>
      </div>

      <div>
        <p className="text-[13px] leading-snug">“{change.intent}”</p>
        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          {transitions.map((t) => (
            <span key={t.key}>
              {agentName(snapshot, t.key)} <span className="font-mono">v{t.from}</span> →{" "}
              <span className="font-mono">v{t.to}</span>
            </span>
          ))}
        </div>
      </div>

      <div className="space-y-1.5 rounded-lg bg-background p-2.5">
        <CheckRow
          label="Configuration"
          state={structuralOk === null ? "running" : structuralOk ? "pass" : "fail"}
          value={structuralOk === null ? "Checking…" : structuralOk ? "Valid" : "Invalid"}
        />
        <CheckRow label="Behavior" state={behavior.state} value={behavior.value} />
      </div>

      <p className="text-sm font-medium leading-snug">{stage.headline}</p>
      <p className="text-xs leading-relaxed text-muted-foreground">{stage.body}</p>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant={stage.action.variant} onClick={stage.action.onClick}>
          {stage.action.label}
          <ArrowRight data-icon="inline-end" />
        </Button>
        {shipment?.status === "shipped" && shipment.prUrl && (
          <Button size="sm" variant="ghost" asChild>
            <a href={shipment.prUrl} target="_blank" rel="noreferrer">
              <GitPullRequest data-icon="inline-start" /> PR #{shipment.prNumber}
              <ExternalLink data-icon="inline-end" />
            </a>
          </Button>
        )}
      </div>
      {stage.hint && <p className="text-[11px] text-muted-foreground">{stage.hint}</p>}
    </section>
  );
}
