import { CircleCheck, CircleDashed, CircleMinus, CircleX, LoaderCircle, TriangleAlert } from "lucide-react";
import type { AssertionStatus } from "@/domain/schemas";
import type { ChangeStatus } from "@/db/schema";
import type { VersionStatus } from "@/server/workspace";
import { cn } from "@/lib/utils";
import type { DisplayStatus } from "./use-workspace";

type AnyStatus = DisplayStatus | AssertionStatus;

const icons: Record<AnyStatus, { icon: typeof CircleCheck; className: string; label: string }> = {
  pass: { icon: CircleCheck, className: "text-emerald-600", label: "Passing" },
  fail: { icon: CircleX, className: "text-rose-600", label: "Failing" },
  error: { icon: TriangleAlert, className: "text-rose-600", label: "Error" },
  running: { icon: LoaderCircle, className: "animate-spin text-sky-600", label: "Running" },
  queued: { icon: CircleDashed, className: "text-muted-foreground", label: "Queued" },
  skipped: { icon: CircleMinus, className: "text-amber-500", label: "Skipped" },
  idle: { icon: CircleDashed, className: "text-muted-foreground", label: "Not run" },
};

export function StatusIcon({ status, className }: { status: AnyStatus; className?: string }) {
  const { icon: Icon, className: tone, label } = icons[status];
  return <Icon aria-label={label} className={cn("size-4 shrink-0", tone, className)} />;
}

export function statusLabel(status: AnyStatus) {
  return icons[status].label;
}

const pill = "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap";

const changeTones: Record<ChangeStatus, { label: string; className: string }> = {
  proposed: { label: "Verifying", className: "border-sky-200 bg-sky-50 text-sky-700" },
  structural_failed: { label: "Structurally invalid", className: "border-rose-200 bg-rose-50 text-rose-700" },
  behavioral_failed: { label: "Blocked", className: "border-rose-200 bg-rose-50 text-rose-700" },
  verified: { label: "Verified", className: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  applied: { label: "Applied", className: "border-emerald-300 bg-emerald-600 text-white" },
};

export function ChangeStatusPill({ status, resolved }: { status: ChangeStatus; resolved?: boolean }) {
  const tone = changeTones[status];
  return (
    <span className={cn(pill, tone.className)}>
      {status === "proposed" && <LoaderCircle className="size-3 animate-spin" />}
      {resolved ? `${tone.label} · fixed` : tone.label}
    </span>
  );
}

const versionTones: Record<VersionStatus, string> = {
  live: "border-emerald-200 bg-emerald-50 text-emerald-700",
  proposed: "border-sky-200 bg-sky-50 text-sky-700",
  verified: "border-emerald-200 bg-emerald-50 text-emerald-700",
  rejected: "border-rose-200 bg-rose-50 text-rose-700",
  superseded: "border-border bg-muted text-muted-foreground",
};

export function VersionPill({ version, status }: { version: number; status?: VersionStatus }) {
  return (
    <span className={cn(pill, "font-mono", status ? versionTones[status] : "border-border bg-background")}>
      v{version}
      {status && status !== "live" && <span className="font-sans font-normal">· {status}</span>}
    </span>
  );
}
