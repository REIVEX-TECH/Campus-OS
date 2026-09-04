-- Reporting a person, not only a thing they wrote.
--
-- Until now every report named a post or a comment, and the answer to somebody
-- who is a problem across a whole university was to remove their posts one at
-- a time. A report about a person belongs to the tenant rather than to any
-- community, which is why `community_id` becomes nullable: there is no honest
-- value to put there, and inventing one would file the report in a community
-- whose moderators are not the people who can act on it.
--
-- Nothing is auto-hidden for a person. Hiding is what happens to a post; the
-- answers to a person are restriction and suspension, and both are decisions a
-- human takes and signs (identity 0014). Repeated reports raise a flag on the
-- tenant's queue and nothing more.
ALTER TABLE "reports" ALTER COLUMN "community_id" DROP NOT NULL;
--> statement-breakpoint

-- The tenant-wide queue reads by (tenant, item_type, status), which the
-- existing index leads with community_id and so cannot serve.
CREATE INDEX "reports_people_idx" ON "reports" ("tenant_id", "item_type", "status", "created_at");
