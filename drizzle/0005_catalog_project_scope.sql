-- Give the application catalog an owning project, so two projects can neither share nor overwrite each other's rows.
--
-- Pre-existing rows predate project ownership. While Architect serves a single project there is exactly one
-- candidate owner, so they are attributed to it rather than discarded; anything still unattributed (no project
-- yet, or more than one) is removed and re-seeded from the project's own seed data on the next boot.
ALTER TABLE "catalog_items" ADD COLUMN "project_id" uuid;--> statement-breakpoint
UPDATE "catalog_items"
  SET "project_id" = (SELECT "id" FROM "projects" LIMIT 1)
  WHERE (SELECT count(*) FROM "projects") = 1;--> statement-breakpoint
DELETE FROM "catalog_items" WHERE "project_id" IS NULL;--> statement-breakpoint
ALTER TABLE "catalog_items" ALTER COLUMN "project_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "catalog_items" DROP CONSTRAINT "catalog_items_pkey";--> statement-breakpoint
ALTER TABLE "catalog_items" ADD CONSTRAINT "catalog_items_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_items" ADD CONSTRAINT "catalog_items_project_id_sku_pk" PRIMARY KEY("project_id","sku");
