import { describeAssertion } from "@/domain/format";
import type { Assertion, ScenarioInput } from "@/domain/schemas";
import { cn } from "@/lib/utils";

type RuleContent = { name: string; intent: string; input: ScenarioInput; assertions: Assertion[] };

/** Identity of a check: everything except its human label. */
const checkKey = (a: Assertion) => describeAssertion(a);

function TextChange({ label, before, after }: { label: string; before: string; after: string }) {
  if (before === after) {
    return (
      <div className="space-y-1">
        <div className="text-[11px] font-medium text-muted-foreground">{label} · unchanged</div>
        <p className="text-xs leading-relaxed text-muted-foreground">{after}</p>
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <div className="text-[11px] font-medium text-muted-foreground">{label}</div>
      <p className="rounded-md bg-rose-50 px-2.5 py-1.5 text-xs leading-relaxed text-rose-900 line-through decoration-rose-300">
        {before}
      </p>
      <p className="rounded-md bg-emerald-50 px-2.5 py-1.5 text-xs leading-relaxed text-emerald-900">{after}</p>
    </div>
  );
}

const sign = { removed: "−", added: "+", kept: "=" };
const tone = {
  removed: "bg-rose-50 text-rose-900",
  added: "bg-emerald-50 text-emerald-900",
  kept: "text-muted-foreground",
};

/** Before/after of a scenario revision: the rule's wording, its customer message, and its checks. */
export function ScenarioRevisionDiff({ before, after }: { before: RuleContent; after: RuleContent }) {
  const beforeKeys = before.assertions.map(checkKey);
  const afterKeys = after.assertions.map(checkKey);
  const rows = [
    ...before.assertions.filter((_, i) => !afterKeys.includes(beforeKeys[i])).map((a) => ({ kind: "removed" as const, a })),
    ...after.assertions.filter((_, i) => !beforeKeys.includes(afterKeys[i])).map((a) => ({ kind: "added" as const, a })),
    ...after.assertions.filter((_, i) => beforeKeys.includes(afterKeys[i])).map((a) => ({ kind: "kept" as const, a })),
  ];
  const counts = {
    removed: rows.filter((r) => r.kind === "removed").length,
    added: rows.filter((r) => r.kind === "added").length,
    kept: rows.filter((r) => r.kind === "kept").length,
  };

  return (
    <div className="space-y-3">
      <TextChange label="Name" before={before.name} after={after.name} />
      <TextChange label="Rule" before={before.intent} after={after.intent} />
      <TextChange label="Customer message" before={before.input.message} after={after.input.message} />
      <div className="space-y-1">
        <div className="text-[11px] font-medium text-muted-foreground">
          Checks · {counts.removed} removed, {counts.added} added, {counts.kept} kept
        </div>
        <div className="overflow-hidden rounded-lg border">
          {rows.map(({ kind, a }, i) => (
            <div key={`${kind}-${i}`} className={cn("flex gap-2 border-b px-2.5 py-1.5 text-[11.5px] last:border-b-0", tone[kind])}>
              <span className="w-3 shrink-0 select-none font-mono">{sign[kind]}</span>
              <span className="min-w-0">
                {a.description && <span className="block">{a.description}</span>}
                <span className={cn("block font-mono", a.description && "opacity-70")}>
                  <span className="mr-1 rounded border border-current/20 px-1 text-[9.5px] uppercase">{a.type}</span>
                  {a.type === "judge" ? a.criterion : describeAssertion(a)}
                </span>
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
