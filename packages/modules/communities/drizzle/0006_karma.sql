-- Karma: what other people did, kept as a cache of a derivation.
--
-- Until now karma was summed live from the score of a person's live items.
-- That number counted an author's vote on their own post, counted a hundred
-- votes from one account the same as a hundred from a hundred, and could not
-- include an anonymous item at all. This replaces it with a materialised pair
-- of totals moved by the vote that causes them, and a recompute that rebuilds
-- them from the votes, so the table is never the only copy.
--
-- Two totals, because a displayed number that moves when an anonymous post is
-- voted on is a channel that names its author: watch the handle, watch the
-- post. The public total is summed on `public_author_id`, which the database
-- generates as null for an anonymous item, so the public number cannot include
-- one by construction rather than by a filter somebody has to remember. The
-- private total is summed on `author_id`, which the application role may not
-- read, so it is maintained here and read back only by its owner.

CREATE TABLE "community_karma" (
	"tenant_id" text NOT NULL REFERENCES "universities"("slug") ON DELETE CASCADE,
	"user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	-- Everything they wrote, signed or not. Theirs alone to see.
	"post_karma" integer DEFAULT 0 NOT NULL,
	"comment_karma" integer DEFAULT 0 NOT NULL,
	-- Signed items only. What a thread may show next to their handle.
	"public_post_karma" integer DEFAULT 0 NOT NULL,
	"public_comment_karma" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL,
	PRIMARY KEY ("tenant_id", "user_id")
);
--> statement-breakpoint

-- How much one account has moved another's karma today, already capped. The
-- application never reads this table and has no policy that would let it: a row
-- names a voter and an author side by side, and the voter knows what they voted
-- on, so reading it would unmask every anonymous author they ever voted for.
CREATE TABLE "karma_ledger" (
	"tenant_id" text NOT NULL REFERENCES "universities"("slug") ON DELETE CASCADE,
	"voter_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"author_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"day" date NOT NULL,
	"points" integer DEFAULT 0 NOT NULL,
	PRIMARY KEY ("tenant_id", "voter_id", "author_id", "day")
);
--> statement-breakpoint

ALTER TABLE "community_karma" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "karma_ledger" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- No FORCE on either: the definer below writes both, and reads the ledger to
-- apply the cap. The application's own reach is set by the policies instead.
--
-- One SELECT policy, for the person's own row, and no write policy at all: the
-- private totals are theirs to read and nobody's to set. Everything public goes
-- through the view below.
CREATE POLICY "karma_own" ON "community_karma" FOR SELECT
	USING (
		"tenant_id" = current_setting('app.tenant_id', true)
		AND "user_id"::text = current_setting('app.user_id', true)
	);
--> statement-breakpoint

-- karma_ledger gets no policy at all, so the application sees nothing in it.

DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'campusos_app') THEN
		EXECUTE 'GRANT SELECT ON community_karma TO campusos_app';
	END IF;
END
$$;
--> statement-breakpoint

-- The public half, for anyone in the tenant. Owned by the schema owner, so it
-- reads past the own-row policy, and bound to the caller's tenant so it can
-- only ever answer for the university they are looking at.
CREATE OR REPLACE VIEW "karma_public" AS
	SELECT k.tenant_id, k.user_id,
	       k.public_post_karma AS post_karma,
	       k.public_comment_karma AS comment_karma,
	       (k.public_post_karma + k.public_comment_karma) AS karma
	FROM community_karma k
	WHERE k.tenant_id = current_setting('app.tenant_id', true);
--> statement-breakpoint

DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'campusos_app') THEN
		EXECUTE 'GRANT SELECT ON karma_public TO campusos_app';
	END IF;
END
$$;
--> statement-breakpoint

-- Move a person's karma for one vote, and never further than the cap allows.
--
-- The caller passes the item and what their vote was and now is; who they are
-- comes from the session, so nobody can spend another account's daily budget.
-- Reading the author needs a column the application role cannot select, which
-- is the whole reason this runs as the owner.
--
-- The cap is on the net karma one voter may give one author in a day, so a
-- pair of accounts cannot inflate each other and a grudge cannot bury anyone.
-- Clamping the running total rather than each vote means changing a vote and
-- changing it back costs nothing and gains nothing.
CREATE OR REPLACE FUNCTION communities_karma_vote(
	p_item_type text, p_item_id uuid, p_previous integer, p_next integer
)
	RETURNS void
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET search_path = public
AS $$
DECLARE
	v_tenant text := nullif(current_setting('app.tenant_id', true), '');
	v_voter uuid := nullif(current_setting('app.user_id', true), '')::uuid;
	v_author uuid;
	v_public uuid;
	v_cap integer;
	v_points integer;
	v_applied integer;
BEGIN
	IF v_tenant IS NULL OR v_voter IS NULL THEN
		RAISE EXCEPTION 'communities_karma_vote: no actor' USING ERRCODE = '42501';
	END IF;
	IF p_item_type = 'post' THEN
		SELECT author_id, public_author_id INTO v_author, v_public
		FROM posts WHERE id = p_item_id AND tenant_id = v_tenant;
	ELSIF p_item_type = 'comment' THEN
		SELECT author_id, public_author_id INTO v_author, v_public
		FROM comments WHERE id = p_item_id AND tenant_id = v_tenant;
	ELSE
		RAISE EXCEPTION 'communities_karma_vote: unknown item' USING ERRCODE = '22023';
	END IF;
	-- Nothing to move, or an author voting on their own item. The vote path
	-- refuses that outright; this is the second lock on the same door.
	IF v_author IS NULL OR v_author = v_voter OR p_previous = p_next THEN
		RETURN;
	END IF;

	SELECT coalesce((config->'moduleSettings'->'communities'->>'karmaVotePerDayCap')::int, 10)
	INTO v_cap FROM tenant_configs WHERE slug = v_tenant;
	v_cap := coalesce(v_cap, 10);

	INSERT INTO karma_ledger (tenant_id, voter_id, author_id, day, points)
	VALUES (v_tenant, v_voter, v_author, current_date, 0)
	ON CONFLICT (tenant_id, voter_id, author_id, day) DO NOTHING;
	SELECT points INTO v_points FROM karma_ledger
	 WHERE tenant_id = v_tenant AND voter_id = v_voter
	   AND author_id = v_author AND day = current_date
	 FOR UPDATE;

	v_applied := greatest(least(v_points + (p_next - p_previous), v_cap), -v_cap) - v_points;
	IF v_applied = 0 THEN
		RETURN;
	END IF;
	UPDATE karma_ledger SET points = v_points + v_applied
	 WHERE tenant_id = v_tenant AND voter_id = v_voter
	   AND author_id = v_author AND day = current_date;

	INSERT INTO community_karma (tenant_id, user_id) VALUES (v_tenant, v_author)
	ON CONFLICT (tenant_id, user_id) DO NOTHING;
	IF p_item_type = 'post' THEN
		UPDATE community_karma SET post_karma = post_karma + v_applied, updated_at = now()
		 WHERE tenant_id = v_tenant AND user_id = v_author;
		-- Null when the item is anonymous, so this matches no row and the
		-- public number cannot move. That is the anonymity guarantee.
		UPDATE community_karma
		   SET public_post_karma = public_post_karma + v_applied, updated_at = now()
		 WHERE tenant_id = v_tenant AND user_id = v_public;
	ELSE
		UPDATE community_karma SET comment_karma = comment_karma + v_applied, updated_at = now()
		 WHERE tenant_id = v_tenant AND user_id = v_author;
		UPDATE community_karma
		   SET public_comment_karma = public_comment_karma + v_applied, updated_at = now()
		 WHERE tenant_id = v_tenant AND user_id = v_public;
	END IF;
END;
$$;
--> statement-breakpoint

DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'campusos_app') THEN
		EXECUTE 'GRANT EXECUTE ON FUNCTION communities_karma_vote(text, uuid, integer, integer) TO campusos_app';
	END IF;
END
$$;
--> statement-breakpoint

-- The vote tables lose FORCE, for the reason the module header already gives:
-- a SECURITY DEFINER function cannot read a table with FORCE, and rebuilding
-- karma means reading everybody's votes at once. Their restrictive "your own
-- votes only" policy is what makes this necessary rather than the tenant
-- policy: with FORCE on, even the owner sees only the votes of whoever the
-- session says it is, which is nobody in a script.
--
-- This costs the safety net that FORCE gave against the application being
-- pointed at the owner credential by mistake, and costs nothing else: in a
-- split database the application owns nothing, so RLS binds it either way.
ALTER TABLE "post_votes" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "comment_votes" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Rebuild a tenant's karma from its votes. The repair for any drift, and the
-- reason the table is a cache rather than the record.
--
-- Votes are replayed in the order they were cast so the daily cap lands where
-- it landed the first time. A vote that was later changed replays once, at its
-- original time, holding the value it ends up with; that is the one place a
-- rebuild can differ from the running total, and it differs by less than the
-- cap. Not granted to the application: the owner runs it, from the script.
CREATE OR REPLACE FUNCTION communities_karma_recompute(p_tenant_id text)
	RETURNS integer
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET search_path = public
AS $$
DECLARE
	v_cap integer;
	v_row record;
	v_points integer;
	v_applied integer;
	v_count integer := 0;
BEGIN
	PERFORM set_config('app.tenant_id', p_tenant_id, true);
	SELECT coalesce((config->'moduleSettings'->'communities'->>'karmaVotePerDayCap')::int, 10)
	INTO v_cap FROM tenant_configs WHERE slug = p_tenant_id;
	v_cap := coalesce(v_cap, 10);

	DELETE FROM karma_ledger WHERE tenant_id = p_tenant_id;
	DELETE FROM community_karma WHERE tenant_id = p_tenant_id;

	FOR v_row IN
		SELECT kind, author_id, public_author_id, voter, value, created_at FROM (
			SELECT 'post' AS kind, p.author_id, p.public_author_id, v.user_id AS voter,
			       v.value, v.created_at
			  FROM post_votes v JOIN posts p ON p.id = v.post_id
			 WHERE v.tenant_id = p_tenant_id AND p.author_id <> v.user_id
			UNION ALL
			SELECT 'comment', c.author_id, c.public_author_id, v.user_id, v.value, v.created_at
			  FROM comment_votes v JOIN comments c ON c.id = v.comment_id
			 WHERE v.tenant_id = p_tenant_id AND c.author_id <> v.user_id
		) replay ORDER BY created_at
	LOOP
		INSERT INTO karma_ledger (tenant_id, voter_id, author_id, day, points)
		VALUES (p_tenant_id, v_row.voter, v_row.author_id, v_row.created_at::date, 0)
		ON CONFLICT (tenant_id, voter_id, author_id, day) DO NOTHING;
		SELECT points INTO v_points FROM karma_ledger
		 WHERE tenant_id = p_tenant_id AND voter_id = v_row.voter
		   AND author_id = v_row.author_id AND day = v_row.created_at::date;
		v_applied := greatest(least(v_points + v_row.value, v_cap), -v_cap) - v_points;
		CONTINUE WHEN v_applied = 0;
		UPDATE karma_ledger SET points = v_points + v_applied
		 WHERE tenant_id = p_tenant_id AND voter_id = v_row.voter
		   AND author_id = v_row.author_id AND day = v_row.created_at::date;

		INSERT INTO community_karma (tenant_id, user_id) VALUES (p_tenant_id, v_row.author_id)
		ON CONFLICT (tenant_id, user_id) DO NOTHING;
		IF v_row.kind = 'post' THEN
			UPDATE community_karma SET post_karma = post_karma + v_applied
			 WHERE tenant_id = p_tenant_id AND user_id = v_row.author_id;
			UPDATE community_karma SET public_post_karma = public_post_karma + v_applied
			 WHERE tenant_id = p_tenant_id AND user_id = v_row.public_author_id;
		ELSE
			UPDATE community_karma SET comment_karma = comment_karma + v_applied
			 WHERE tenant_id = p_tenant_id AND user_id = v_row.author_id;
			UPDATE community_karma SET public_comment_karma = public_comment_karma + v_applied
			 WHERE tenant_id = p_tenant_id AND user_id = v_row.public_author_id;
		END IF;
		v_count := v_count + 1;
	END LOOP;
	RETURN v_count;
END;
$$;
--> statement-breakpoint

-- Nothing is lost on the way in: every tenant's existing votes are replayed
-- now, so a profile that showed karma yesterday still shows one today. The
-- number moves, because it no longer counts an author's vote on their own item
-- and no longer lets one account move another's without limit.
DO $$
DECLARE
	t text;
BEGIN
	FOR t IN SELECT slug FROM universities LOOP
		PERFORM communities_karma_recompute(t);
	END LOOP;
END
$$;
