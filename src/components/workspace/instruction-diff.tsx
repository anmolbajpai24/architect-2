import { lineDiff } from "@/domain/format";
import { cn } from "@/lib/utils";

/** Line-level diff of agent instructions: removed lines in red, added lines in green. */
export function InstructionDiff({ before, after, className }: { before: string; after: string; className?: string }) {
  const { removed, added } = lineDiff(before, after);
  if (!removed.length && !added.length) {
    return <p className="text-xs text-muted-foreground">Instructions unchanged.</p>;
  }
  return (
    <div className={cn("overflow-hidden rounded-lg border font-mono text-[11.5px] leading-relaxed", className)}>
      {removed.map((l) => (
        <div key={`-${l}`} className="flex gap-2 bg-rose-50 px-3 py-1 text-rose-900">
          <span className="select-none text-rose-400">−</span>
          <span className="whitespace-pre-wrap">{l}</span>
        </div>
      ))}
      {added.map((l) => (
        <div key={`+${l}`} className="flex gap-2 bg-emerald-50 px-3 py-1 text-emerald-900">
          <span className="select-none text-emerald-500">+</span>
          <span className="whitespace-pre-wrap">{l}</span>
        </div>
      ))}
    </div>
  );
}
