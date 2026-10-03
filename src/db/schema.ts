import {
  boolean,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import type { AgentConfig, Assertion, ScenarioInput, ScenarioResult } from "@/domain/schemas";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

/**
 * A project Architect runs. Two kinds, one table: a project whose slug matches a definition in
 * src/projects/registry.ts is backed by code (its tools and deterministic simulator live there), and any other
 * project was created from a natural-language brief and carries everything it needs in these columns.
 */
export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  /** The brief this project was created from. Null for a project backed by a definition in code. */
  brief: text("brief"),
  /** One sentence telling the LLM judge what this application is (ProjectDefinition.judgeContext). */
  judgeContext: text("judge_context"),
  /** Where the entry agent's user-facing response lives in its output (ProjectDefinition.responsePath). */
  responsePath: text("response_path"),
  createdAt: createdAt(),
});

export const agents = pgTable(
  "agents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    name: text("name").notNull(),
    /** Moves only when a verified Change is applied. */
    currentVersionId: uuid("current_version_id").references((): AnyPgColumn => agentVersions.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("agents_project_key").on(t.projectId, t.key)],
);

/** Immutable: rows are only ever inserted. */
export const agentVersions = pgTable(
  "agent_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    config: jsonb("config").$type<AgentConfig>().notNull(),
    /** The Change that proposed this version; null for the seeded baseline. */
    changeId: uuid("change_id").references((): AnyPgColumn => changes.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("agent_versions_agent_version").on(t.agentId, t.version)],
);

export const scenarios = pgTable(
  "scenarios",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    /** The live rule. Moves only when the user explicitly applies a scenario revision. */
    currentVersionId: uuid("current_version_id").references((): AnyPgColumn => scenarioVersions.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("scenarios_project_key").on(t.projectId, t.key)],
);

/** Who drafted a revision's content and why, as told to the user. */
export type ScenarioProposal = { mode: "fixture" | "live"; model: string; rationale: string };

/**
 * Immutable scenario content. A revision is drafted (proposed), then applied or discarded by the user;
 * only `appliedAt` / `discardedAt` are ever set after insert.
 */
export const scenarioVersions = pgTable(
  "scenario_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scenarioId: uuid("scenario_id")
      .notNull()
      .references(() => scenarios.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    name: text("name").notNull(),
    /** The user intent this scenario protects, in plain language. */
    intent: text("intent").notNull(),
    input: jsonb("input").$type<ScenarioInput>().notNull(),
    assertions: jsonb("assertions").$type<Assertion[]>().notNull(),
    /** The version this one revises; null for the seeded baseline. */
    basedOnVersionId: uuid("based_on_version_id").references((): AnyPgColumn => scenarioVersions.id, {
      onDelete: "set null",
    }),
    /** The blocked Change that led the user to change the rule, if any. */
    changeId: uuid("change_id").references((): AnyPgColumn => changes.id, { onDelete: "set null" }),
    /** The user's own words for the new requirement. */
    request: text("request"),
    proposal: jsonb("proposal").$type<ScenarioProposal>(),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    discardedAt: timestamp("discarded_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("scenario_versions_scenario_version").on(t.scenarioId, t.version)],
);

export type ChangeStatus = "proposed" | "structural_failed" | "behavioral_failed" | "verified" | "applied";

export type StructuralCheck = { check: string; ok: boolean; message: string };

export type ChangeExplanation = {
  summary: string;
  failures: { scenario: string; intent: string; assertion: string; expected: string; actual: string }[];
  instructionDiff: { agent: string; removed: string[]; added: string[] }[];
  options: { id: "keep_rule_fix" | "change_rule"; label: string }[];
};

/** Who drafted a change's edits and why, as told to the user. */
export type ChangeProposal = { mode: "fixture" | "live"; model: string; rationale: string };

export const changes = pgTable("changes", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  parentChangeId: uuid("parent_change_id").references((): AnyPgColumn => changes.id, { onDelete: "set null" }),
  intent: text("intent").notNull(),
  status: text("status").$type<ChangeStatus>().notNull().default("proposed"),
  /** agentKey -> versionId the change was based on. */
  baseVersionIds: jsonb("base_version_ids").$type<Record<string, string>>().notNull(),
  /** agentKey -> versionId the change proposes. */
  proposedVersionIds: jsonb("proposed_version_ids").$type<Record<string, string>>().notNull(),
  structural: jsonb("structural").$type<StructuralCheck[]>(),
  explanation: jsonb("explanation").$type<ChangeExplanation>(),
  /** Null for changes whose edits were supplied directly (e.g. by a script). */
  proposal: jsonb("proposal").$type<ChangeProposal>(),
  /** How the user resolved a failed change, e.g. "keep_rule_fix". */
  resolution: text("resolution"),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type RunStatus = "running" | "passed" | "failed";

export const runs = pgTable("runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  changeId: uuid("change_id").references(() => changes.id, { onDelete: "set null" }),
  trigger: text("trigger").$type<"manual" | "change">().notNull(),
  status: text("status").$type<RunStatus>().notNull().default("running"),
  modelMode: text("model_mode").$type<"fixture" | "live">().notNull(),
  versionIds: jsonb("version_ids").$type<Record<string, string>>().notNull(),
  results: jsonb("results").$type<ScenarioResult[]>(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

export type ShipmentStatus = "shipping" | "shipped" | "failed";

/**
 * GitHub provenance of a shipped Change: one row per Change (the unique key is also the claim that stops two
 * concurrent ship attempts). Progress (branch, commit) is saved as it happens so a retry resumes, not duplicates.
 */
export const changeShipments = pgTable(
  "change_shipments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    changeId: uuid("change_id")
      .notNull()
      .references(() => changes.id, { onDelete: "cascade" }),
    status: text("status").$type<ShipmentStatus>().notNull(),
    /** "owner/name". */
    repository: text("repository").notNull(),
    baseBranch: text("base_branch"),
    branch: text("branch").notNull(),
    commitSha: text("commit_sha"),
    prNumber: integer("pr_number"),
    prUrl: text("pr_url"),
    /** The live-agent run whose passing results the PR reports. */
    runId: uuid("run_id").references(() => runs.id, { onDelete: "set null" }),
    error: text("error"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    shippedAt: timestamp("shipped_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("change_shipments_change").on(t.changeId)],
);

/** Append-only log; later streamed to the UI over SSE. */
export const events = pgTable("events", {
  seq: serial("seq").primaryKey(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  runId: uuid("run_id").references(() => runs.id, { onDelete: "cascade" }),
  changeId: uuid("change_id").references(() => changes.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  createdAt: createdAt(),
});

/**
 * Application data belonging to a project. The columns are the Laptop Advisor demo's product catalog: this is the
 * one table in the schema that is shaped by an application rather than by Architect's own domain. It is owned by a
 * project so that a second project can neither read nor overwrite this one's catalog.
 */
export const catalogItems = pgTable(
  "catalog_items",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    sku: text("sku").notNull(),
    name: text("name").notNull(),
    priceUsd: integer("price_usd").notNull(),
    cpu: text("cpu").notNull(),
    ramGb: integer("ram_gb").notNull(),
    storageGb: integer("storage_gb").notNull(),
    gpu: text("gpu").notNull(),
    dedicatedGpu: boolean("dedicated_gpu").notNull(),
    weightKg: real("weight_kg").notNull(),
    screenIn: real("screen_in").notNull(),
    batteryHours: integer("battery_hours").notNull(),
    useCases: jsonb("use_cases").$type<string[]>().notNull(),
    inStock: boolean("in_stock").notNull().default(true),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.sku] })],
);
