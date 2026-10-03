import {
  boolean,
  integer,
  jsonb,
  pgTable,
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

export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
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
    name: text("name").notNull(),
    /** The user intent this scenario protects, in plain language. */
    intent: text("intent").notNull(),
    input: jsonb("input").$type<ScenarioInput>().notNull(),
    assertions: jsonb("assertions").$type<Assertion[]>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("scenarios_project_key").on(t.projectId, t.key)],
);

export type ChangeStatus = "proposed" | "structural_failed" | "behavioral_failed" | "verified" | "applied";

export type StructuralCheck = { check: string; ok: boolean; message: string };

export type ChangeExplanation = {
  summary: string;
  failures: { scenario: string; intent: string; assertion: string; expected: string; actual: string }[];
  instructionDiff: { agent: string; removed: string[]; added: string[] }[];
  options: { id: "keep_rule_fix" | "change_rule"; label: string }[];
};

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

/** Demo application data: the laptop store's catalog. */
export const catalogItems = pgTable("catalog_items", {
  sku: text("sku").primaryKey(),
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
});
