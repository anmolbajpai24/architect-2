import { cn } from "@/lib/utils";

/**
 * The expandable technical layer. Every object in the workspace has a plain-language face and a precise one;
 * this is how the precise one stays one click away instead of dominating the default view.
 */
export function Disclosure({
  label,
  hint,
  defaultOpen = false,
  className,
  children,
}: {
  label: React.ReactNode;
  hint?: React.ReactNode;
  defaultOpen?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <details open={defaultOpen} className={cn("group rounded-lg border bg-background", className)}>
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs font-medium hover:bg-muted/50">
        <span className="text-muted-foreground transition-transform group-open:rotate-90">›</span>
        <span className="min-w-0 flex-1">{label}</span>
        {hint && <span className="shrink-0 text-[11px] font-normal text-muted-foreground">{hint}</span>}
      </summary>
      <div className="border-t px-3 py-2.5">{children}</div>
    </details>
  );
}
