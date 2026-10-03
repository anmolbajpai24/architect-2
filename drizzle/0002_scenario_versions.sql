CREATE TABLE "scenario_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scenario_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"name" text NOT NULL,
	"intent" text NOT NULL,
	"input" jsonb NOT NULL,
	"assertions" jsonb NOT NULL,
	"based_on_version_id" uuid,
	"change_id" uuid,
	"request" text,
	"proposal" jsonb,
	"applied_at" timestamp with time zone,
	"discarded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "scenarios" ADD COLUMN "current_version_id" uuid;--> statement-breakpoint
ALTER TABLE "scenario_versions" ADD CONSTRAINT "scenario_versions_scenario_id_scenarios_id_fk" FOREIGN KEY ("scenario_id") REFERENCES "public"."scenarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenario_versions" ADD CONSTRAINT "scenario_versions_based_on_version_id_scenario_versions_id_fk" FOREIGN KEY ("based_on_version_id") REFERENCES "public"."scenario_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenario_versions" ADD CONSTRAINT "scenario_versions_change_id_changes_id_fk" FOREIGN KEY ("change_id") REFERENCES "public"."changes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "scenario_versions_scenario_version" ON "scenario_versions" USING btree ("scenario_id","version");--> statement-breakpoint
ALTER TABLE "scenarios" ADD CONSTRAINT "scenarios_current_version_id_scenario_versions_id_fk" FOREIGN KEY ("current_version_id") REFERENCES "public"."scenario_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Backfill: every existing scenario becomes its own v1 (applied at creation) and points at it.
INSERT INTO "scenario_versions" ("scenario_id", "version", "name", "intent", "input", "assertions", "applied_at", "created_at")
SELECT "id", 1, "name", "intent", "input", "assertions", "created_at", "created_at" FROM "scenarios";--> statement-breakpoint
UPDATE "scenarios" SET "current_version_id" = v."id" FROM "scenario_versions" v WHERE v."scenario_id" = "scenarios"."id" AND v."version" = 1;
