CREATE TABLE "universities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"timezone" text NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "universities_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "campuses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "buildings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"campus_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "rooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"building_id" uuid NOT NULL,
	"name" text NOT NULL,
	"capacity" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "campuses" ADD CONSTRAINT "campuses_tenant_id_universities_slug_fk" FOREIGN KEY ("tenant_id") REFERENCES "universities"("slug") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "buildings" ADD CONSTRAINT "buildings_tenant_id_universities_slug_fk" FOREIGN KEY ("tenant_id") REFERENCES "universities"("slug") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "buildings" ADD CONSTRAINT "buildings_campus_id_campuses_id_fk" FOREIGN KEY ("campus_id") REFERENCES "campuses"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_tenant_id_universities_slug_fk" FOREIGN KEY ("tenant_id") REFERENCES "universities"("slug") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_building_id_buildings_id_fk" FOREIGN KEY ("building_id") REFERENCES "buildings"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "campuses_tenant_idx" ON "campuses" ("tenant_id");
--> statement-breakpoint
CREATE INDEX "buildings_tenant_idx" ON "buildings" ("tenant_id");
--> statement-breakpoint
CREATE INDEX "buildings_tenant_campus_idx" ON "buildings" ("tenant_id","campus_id");
--> statement-breakpoint
CREATE INDEX "rooms_tenant_idx" ON "rooms" ("tenant_id");
--> statement-breakpoint
CREATE INDEX "rooms_tenant_building_idx" ON "rooms" ("tenant_id","building_id");
