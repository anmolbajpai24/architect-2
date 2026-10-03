CREATE TABLE "change_shipments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"change_id" uuid NOT NULL,
	"status" text NOT NULL,
	"repository" text NOT NULL,
	"base_branch" text,
	"branch" text NOT NULL,
	"commit_sha" text,
	"pr_number" integer,
	"pr_url" text,
	"run_id" uuid,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"shipped_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "change_shipments" ADD CONSTRAINT "change_shipments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_shipments" ADD CONSTRAINT "change_shipments_change_id_changes_id_fk" FOREIGN KEY ("change_id") REFERENCES "public"."changes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_shipments" ADD CONSTRAINT "change_shipments_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "change_shipments_change" ON "change_shipments" USING btree ("change_id");