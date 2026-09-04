-- Participation gates: what a community may ask for before someone writes in it.
--
-- Five settings, all optional, all defaulting to what the module already did,
-- so this migration changes nobody's experience until a moderator sets one.
--
-- Account age is age: days since the account was created. Nothing here measures
-- time spent in the app and nothing ever will, because a gate that rewards
-- lingering punishes people with less time to linger.
--
-- The tenant sets a floor and a community may only tighten it (§12), which is
-- computed where the check runs rather than stored, so raising a tenant's floor
-- takes effect everywhere at once instead of needing every community rewritten.
ALTER TABLE "communities"
	ADD COLUMN "min_karma_to_post" integer DEFAULT 0 NOT NULL,
	ADD COLUMN "min_karma_to_comment" integer DEFAULT 0 NOT NULL,
	ADD COLUMN "min_karma_to_join" integer DEFAULT 0 NOT NULL,
	ADD COLUMN "min_account_age_days" integer DEFAULT 0 NOT NULL,
	-- On by default, and it can only ever tighten: verification is already
	-- required for every write in this module, so a community turning this off
	-- loosens nothing today. The tenant floor is what keeps it that way.
	ADD COLUMN "require_verified" boolean DEFAULT true NOT NULL;
