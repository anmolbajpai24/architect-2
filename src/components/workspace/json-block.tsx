import { cn } from "@/lib/utils";

export function JsonBlock({ value, className }: { value: unknown; className?: string }) {
  return (
    <pre
      className={cn(
        "max-h-72 overflow-auto rounded-lg border bg-muted/40 p-3 font-mono text-[11.5px] leading-relaxed text-foreground/90",
        className,
      )}
    >
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}
