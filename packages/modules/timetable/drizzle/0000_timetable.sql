CREATE TYPE "timetable_entry_kind" AS ENUM('lecture', 'lab', 'tutorial', 'exam');
--> statement-breakpoint
CREATE TYPE "ingestion_status" AS ENUM('running', 'success', 'failed', 'partial');
--> statement-breakpoint
CREATE TYPE "subscription_target" AS ENUM('section', 'teacher', 'room');
--> statement-breakpoint
CREATE TYPE "record_status" AS ENUM('active', 'pending');
--> statement-breakpoint
CREATE TYPE "unmapped_status" AS ENUM('pending', 'resolved', 'ignored');
--> statement-breakpoint
CREATE TABLE "academic_terms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"starts_on" date,
	"ends_on" date,
	"status" "record_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "departments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "programs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"department_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"degree_level" text,
	"status" "record_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "courses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"department_id" uuid,
	"code" text NOT NULL,
	"title" text NOT NULL,
	"credit_hours" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "teachers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"department_id" uuid,
	"name" text NOT NULL,
	"title" text,
	"employee_code" text,
	"email" text,
	"status" "record_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"program_id" uuid NOT NULL,
	"term_id" uuid NOT NULL,
	"name" text NOT NULL,
	"semester" integer,
	"status" "record_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "timetable_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"term_id" uuid NOT NULL,
	"section_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"teacher_id" uuid,
	"room_id" uuid,
	"day_of_week" smallint NOT NULL,
	"starts_at" time NOT NULL,
	"ends_at" time NOT NULL,
	"kind" "timetable_entry_kind" NOT NULL,
	"source_ref" text,
	"content_hash" text NOT NULL,
	"valid_from" timestamp with time zone DEFAULT now() NOT NULL,
	"valid_to" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tt_entries_day_range" CHECK ("day_of_week" between 1 and 7),
	CONSTRAINT "tt_entries_time_order" CHECK ("ends_at" > "starts_at")
);
--> statement-breakpoint
CREATE TABLE "ingestion_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"source" text NOT NULL,
	"status" "ingestion_status" DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"stats" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "source_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"ingestion_run_id" uuid NOT NULL,
	"source_ref" text,
	"payload" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "unmapped_source_values" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"ingestion_run_id" uuid,
	"kind" text NOT NULL,
	"raw_value" text NOT NULL,
	"normalized_guess" text,
	"resolved_id" uuid,
	"status" "unmapped_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_saved_sections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"section_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "change_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"target_type" "subscription_target" NOT NULL,
	"target_id" uuid NOT NULL,
	"channel" text DEFAULT 'email' NOT NULL,
	"last_notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "academic_terms" ADD CONSTRAINT "academic_terms_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "universities"("slug") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "universities"("slug") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "programs" ADD CONSTRAINT "programs_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "universities"("slug") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "programs" ADD CONSTRAINT "programs_department_fk" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "universities"("slug") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_department_fk" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE set null;
--> statement-breakpoint
ALTER TABLE "teachers" ADD CONSTRAINT "teachers_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "universities"("slug") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "teachers" ADD CONSTRAINT "teachers_department_fk" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE set null;
--> statement-breakpoint
ALTER TABLE "sections" ADD CONSTRAINT "sections_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "universities"("slug") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "sections" ADD CONSTRAINT "sections_program_fk" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "sections" ADD CONSTRAINT "sections_term_fk" FOREIGN KEY ("term_id") REFERENCES "academic_terms"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "timetable_entries" ADD CONSTRAINT "tt_entries_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "universities"("slug") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "timetable_entries" ADD CONSTRAINT "tt_entries_term_fk" FOREIGN KEY ("term_id") REFERENCES "academic_terms"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "timetable_entries" ADD CONSTRAINT "tt_entries_section_fk" FOREIGN KEY ("section_id") REFERENCES "sections"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "timetable_entries" ADD CONSTRAINT "tt_entries_course_fk" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "timetable_entries" ADD CONSTRAINT "tt_entries_teacher_fk" FOREIGN KEY ("teacher_id") REFERENCES "teachers"("id") ON DELETE set null;
--> statement-breakpoint
ALTER TABLE "timetable_entries" ADD CONSTRAINT "tt_entries_room_fk" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE set null;
--> statement-breakpoint
ALTER TABLE "source_snapshots" ADD CONSTRAINT "source_snapshots_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "universities"("slug") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "source_snapshots" ADD CONSTRAINT "source_snapshots_run_fk" FOREIGN KEY ("ingestion_run_id") REFERENCES "ingestion_runs"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "ingestion_runs" ADD CONSTRAINT "ingestion_runs_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "universities"("slug") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "unmapped_source_values" ADD CONSTRAINT "unmapped_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "universities"("slug") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "unmapped_source_values" ADD CONSTRAINT "unmapped_run_fk" FOREIGN KEY ("ingestion_run_id") REFERENCES "ingestion_runs"("id") ON DELETE set null;
--> statement-breakpoint
ALTER TABLE "user_saved_sections" ADD CONSTRAINT "user_saved_sections_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "universities"("slug") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "user_saved_sections" ADD CONSTRAINT "user_saved_sections_section_fk" FOREIGN KEY ("section_id") REFERENCES "sections"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "change_subscriptions" ADD CONSTRAINT "change_subscriptions_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "universities"("slug") ON DELETE cascade;
--> statement-breakpoint
CREATE UNIQUE INDEX "academic_terms_tenant_code_uq" ON "academic_terms" ("tenant_id", "code");
--> statement-breakpoint
CREATE UNIQUE INDEX "departments_tenant_code_uq" ON "departments" ("tenant_id", "code");
--> statement-breakpoint
CREATE UNIQUE INDEX "programs_tenant_code_uq" ON "programs" ("tenant_id", "code");
--> statement-breakpoint
CREATE INDEX "programs_tenant_department_idx" ON "programs" ("tenant_id", "department_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "courses_tenant_code_uq" ON "courses" ("tenant_id", "code");
--> statement-breakpoint
CREATE INDEX "courses_tenant_department_idx" ON "courses" ("tenant_id", "department_id");
--> statement-breakpoint
CREATE INDEX "teachers_tenant_department_idx" ON "teachers" ("tenant_id", "department_id");
--> statement-breakpoint
CREATE INDEX "sections_tenant_term_idx" ON "sections" ("tenant_id", "term_id");
--> statement-breakpoint
CREATE INDEX "sections_tenant_program_idx" ON "sections" ("tenant_id", "program_id");
--> statement-breakpoint
CREATE INDEX "tt_entries_section_idx" ON "timetable_entries" ("tenant_id", "section_id", "valid_to");
--> statement-breakpoint
CREATE INDEX "tt_entries_teacher_idx" ON "timetable_entries" ("tenant_id", "teacher_id", "valid_to");
--> statement-breakpoint
CREATE INDEX "tt_entries_room_day_idx" ON "timetable_entries" ("tenant_id", "room_id", "day_of_week", "valid_to");
--> statement-breakpoint
CREATE INDEX "tt_entries_term_idx" ON "timetable_entries" ("tenant_id", "term_id", "valid_to");
--> statement-breakpoint
CREATE UNIQUE INDEX "tt_entries_current_hash_uq" ON "timetable_entries" ("tenant_id", "content_hash") WHERE "valid_to" is null;
--> statement-breakpoint
CREATE INDEX "ingestion_runs_tenant_started_idx" ON "ingestion_runs" ("tenant_id", "started_at");
--> statement-breakpoint
CREATE INDEX "source_snapshots_run_idx" ON "source_snapshots" ("tenant_id", "ingestion_run_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "unmapped_tenant_kind_value_uq" ON "unmapped_source_values" ("tenant_id", "kind", "raw_value");
--> statement-breakpoint
CREATE INDEX "unmapped_tenant_status_idx" ON "unmapped_source_values" ("tenant_id", "status");
--> statement-breakpoint
CREATE UNIQUE INDEX "saved_sections_uq" ON "user_saved_sections" ("tenant_id", "user_id", "section_id");
--> statement-breakpoint
CREATE INDEX "saved_sections_user_idx" ON "user_saved_sections" ("tenant_id", "user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "change_subs_uq" ON "change_subscriptions" ("tenant_id", "user_id", "target_type", "target_id");
--> statement-breakpoint
CREATE INDEX "change_subs_target_idx" ON "change_subscriptions" ("tenant_id", "target_type", "target_id");
