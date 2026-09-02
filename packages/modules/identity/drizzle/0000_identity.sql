-- Identity tables. Platform level except tenant_memberships, which joins a user
-- to a university. See docs/design-identity.md.

CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"google_sub" text NOT NULL,
	"email" text NOT NULL,
	"email_verified_at" timestamp with time zone NOT NULL,
	"handle" text NOT NULL,
	"handle_changed_at" timestamp with time zone,
	"avatar_seed" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"user_agent" text,
	"ip_hash" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tenant_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL REFERENCES "universities"("slug") ON DELETE cascade,
	"user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
	"role" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "platform_roles" (
	"user_id" uuid PRIMARY KEY REFERENCES "users"("id") ON DELETE cascade,
	"role" text NOT NULL,
	"granted_by" uuid REFERENCES "users"("id") ON DELETE set null,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "handle_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
	"handle" text NOT NULL,
	"released_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reserved_until" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_user_id" uuid REFERENCES "users"("id") ON DELETE set null,
	"admin_tenant_session_id" uuid,
	"tenant_id" text,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"request_id" text,
	"ip_hash" text,
	"meta" jsonb
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "users_google_sub_uq" ON "users" ("google_sub");
--> statement-breakpoint
-- Lowered indexes rather than citext: no extension needed, same guarantee that
-- two handles cannot differ only by case.
CREATE UNIQUE INDEX IF NOT EXISTS "users_email_lower_uq" ON "users" (lower("email"));
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "users_handle_lower_uq" ON "users" (lower("handle"));
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sessions_token_hash_uq" ON "sessions" ("token_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sessions_user_idx" ON "sessions" ("user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tenant_memberships_tenant_user_uq" ON "tenant_memberships" ("tenant_id","user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tenant_memberships_user_idx" ON "tenant_memberships" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "handle_history_handle_idx" ON "handle_history" (lower("handle"));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_tenant_at_idx" ON "audit_log" ("tenant_id","at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_actor_idx" ON "audit_log" ("actor_user_id");
