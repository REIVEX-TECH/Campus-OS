CREATE UNIQUE INDEX IF NOT EXISTS "rooms_tenant_dedup_uq" ON "rooms" ("tenant_id", "dedup_key") WHERE "deleted_at" IS NULL;
