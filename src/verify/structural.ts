import type { StructuralCheck } from "@/db/schema";
import { AgentConfig, type Assertion, type VersionSet } from "@/domain/schemas";
import { SearchCatalogInput, TOOL_NAMES } from "@/runtime/tools";

/** Top-level input fields per registered tool, for validating "args.*" assertion paths. */
const TOOL_INPUT_FIELDS: Record<string, string[]> = {
  search_catalog: Object.keys(SearchCatalogInput.shape),
};

/** Whether a dot path can resolve inside a JSON Schema (objects via properties, arrays via numeric index). */
export function schemaHasPath(schema: any, path: string): boolean {
  let node = schema;
  for (const seg of path.split(".")) {
    const types = [node?.type].flat();
    if (types.includes("object") && node.properties?.[seg]) node = node.properties[seg];
    else if (types.includes("array") && /^\d+$/.test(seg) && node.items) node = node.items;
    else return false;
  }
  return true;
}

function check(name: string, problems: string[], okMessage: string): StructuralCheck {
  return { check: name, ok: problems.length === 0, message: problems.length ? problems.join("; ") : okMessage };
}

/**
 * Structural verification: is the agent system well-formed, and do the scenarios still point at things that exist?
 * It says nothing about behavior; that is what running the scenarios is for.
 */
export function checkStructure(versions: VersionSet, scenarios: { key: string; assertions: Assertion[] }[]): StructuralCheck[] {
  const keys = Object.keys(versions);

  const schemaProblems = keys.flatMap((k) => {
    const r = AgentConfig.safeParse(versions[k].config);
    return r.success ? [] : [`${k}: ${r.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join(", ")}`];
  });

  const toolProblems = keys.flatMap((k) =>
    versions[k].config.tools
      .filter((t) => !(TOOL_NAMES as readonly string[]).includes(t))
      .map((t) => `${k} uses unknown tool "${t}"`),
  );

  const handoffProblems = keys.flatMap((k) =>
    versions[k].config.handoffs.flatMap((h) =>
      h === k ? [`${k} hands off to itself`] : versions[h] ? [] : [`${k} hands off to unknown agent "${h}"`],
    ),
  );

  const targets = new Set(keys.flatMap((k) => versions[k].config.handoffs));
  const roots = keys.filter((k) => !targets.has(k));
  const graphProblems: string[] = [];
  if (roots.length !== 1) graphProblems.push(`expected exactly one entry agent, found ${roots.length} (${roots.join(", ")})`);
  const visiting = new Set<string>();
  const visit = (k: string, path: string[]) => {
    if (visiting.has(k)) return graphProblems.push(`handoff cycle: ${[...path, k].join(" -> ")}`);
    visiting.add(k);
    for (const h of versions[k]?.config.handoffs ?? []) visit(h, [...path, k]);
    visiting.delete(k);
  };
  keys.forEach((k) => visit(k, []));

  const refProblems = scenarios.flatMap((s) =>
    s.assertions.flatMap((a): string[] => {
      const where = `scenario ${s.key}`;
      if (a.type === "tool") {
        const users = keys.filter((k) => versions[k].config.tools.includes(a.tool));
        if (users.length === 0) return [`${where}: no agent has tool "${a.tool}"`];
        if (a.agent && !users.includes(a.agent)) return [`${where}: ${a.agent} does not have tool "${a.tool}"`];
        const [source, field] = a.path.split(".");
        if (source === "args" && !TOOL_INPUT_FIELDS[a.tool]?.includes(field))
          return [`${where}: ${a.tool} has no input "${field}"`];
        return [];
      }
      if (!versions[a.agent]) return [`${where}: unknown agent "${a.agent}"`];
      if (a.type === "output" && !schemaHasPath(versions[a.agent].config.outputSchema, a.path))
        return [`${where}: ${a.agent} output has no "${a.path}"`];
      return [];
    }),
  );

  return [
    check("config_schema", schemaProblems, `${keys.length} agent configs are valid`),
    check("tools_registered", toolProblems, "all referenced tools are registered"),
    check("handoffs_resolve", handoffProblems, "all handoffs point at existing agents"),
    check("handoff_graph", graphProblems, `single entry agent (${roots[0]}), no cycles`),
    check(
      "scenario_references",
      refProblems,
      `${scenarios.reduce((n, s) => n + s.assertions.length, 0)} assertions resolve against current agents, tools and output schemas`,
    ),
  ];
}
