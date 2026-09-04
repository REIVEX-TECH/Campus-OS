-- Rules acceptance: when a member first posts in a community that has rules,
-- they say they have read them, once. Recorded on the membership row, which
-- the application reads and writes as the person under the tenant policy.
ALTER TABLE "community_memberships" ADD COLUMN "rules_accepted_at" timestamptz;
