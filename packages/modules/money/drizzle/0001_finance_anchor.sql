-- The platform finance authorization anchor (design-money-movements.md §2, Q1 =
-- platform finance stamp, user-decided). Every money-moving definer keys on a
-- use-row stamped with pg_current_xact_id() (§8: never on a GUC). The stamp is
-- written only by auth_begin_finance, which self-checks platform_admin from
-- platform_roles (a table the app cannot write, identity 0016). auth_finance_admin_
-- for_txn reads the stamp for THIS txid — a row the caller cannot see, forge, or
-- carry across transactions.

CREATE TABLE "platform_finance_uses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"txid" xid8 NOT NULL,
	"at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "platform_finance_uses_txid_idx" ON "platform_finance_uses" ("txid");
--> statement-breakpoint
-- RLS on, NO FORCE: the definers read/write as owner (owner bypasses when NO FORCE);
-- the app is a non-owner and, with NO policy at all, sees and writes nothing.
ALTER TABLE "platform_finance_uses" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Belt and braces (0018/0019 discipline): revoke every app right by name, so even
-- with the default table grant the app cannot touch the stamp table directly.
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'campusos_app')
	   AND NOT EXISTS (
	     SELECT 1 FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner
	     WHERE c.relname = 'platform_finance_uses' AND r.rolname = 'campusos_app'
	   ) THEN
		EXECUTE 'REVOKE ALL ON TABLE "platform_finance_uses" FROM campusos_app';
	END IF;
END
$$;
--> statement-breakpoint

-- Begin a finance transaction: verify the CALLER is a platform admin and stamp the
-- current txid. app-callable (it self-checks and only ever stamps for the caller).
CREATE OR REPLACE FUNCTION auth_begin_finance()
	RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
	v_user uuid := nullif(current_setting('app.user_id', true), '')::uuid;
BEGIN
	IF v_user IS NULL THEN
		RAISE EXCEPTION 'no actor context' USING ERRCODE = '42501';
	END IF;
	IF NOT EXISTS (
		SELECT 1 FROM platform_roles pr
		WHERE pr.user_id = v_user AND pr.role = 'platform_admin'
	) THEN
		RAISE EXCEPTION 'not a platform admin' USING ERRCODE = '42501';
	END IF;
	INSERT INTO platform_finance_uses (actor_user_id, txid) VALUES (v_user, pg_current_xact_id());
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION auth_begin_finance() FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'campusos_app') THEN
		EXECUTE 'GRANT EXECUTE ON FUNCTION auth_begin_finance() TO campusos_app';
	END IF;
END
$$;
--> statement-breakpoint

-- The anchor every money definer reads: the platform admin who authorized THIS txn,
-- or NULL. app-callable read (the app has no read on the uses table).
CREATE OR REPLACE FUNCTION auth_finance_admin_for_txn()
	RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
	SELECT u.actor_user_id FROM platform_finance_uses u
	WHERE u.txid = pg_current_xact_id_if_assigned()
	ORDER BY u.at DESC LIMIT 1;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION auth_finance_admin_for_txn() FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'campusos_app') THEN
		EXECUTE 'GRANT EXECUTE ON FUNCTION auth_finance_admin_for_txn() TO campusos_app';
	END IF;
END
$$;

-- §6 REVIEW NOTES (for the human):
--  * platform_finance_uses: is NO FORCE right? The definers run as owner; NO FORCE
--    lets the owner read/write across the (policy-less) table. The app is a non-owner
--    with ALL revoked by name -> cannot read the stamp, so cannot learn or forge it.
--    A FORCE table would bind the owner and break the definers (they set no GUC).
--  * auth_begin_finance keys the ADMIN CHECK on app.user_id (a GUC) — allowed because
--    it is not the privilege decision; it only decides WHOSE stamp to write. The
--    unforgeable part is the STAMP: a later money definer asks "is there a stamp for
--    pg_current_xact_id()?" — a row the caller cannot see/forge/carry. This mirrors
--    identity 0018 auth_grant_admin_for_txn exactly.
--  * pg_current_xact_id() (begin) assigns a real txid; auth_finance_admin_for_txn uses
--    pg_current_xact_id_if_assigned() so a read-only txn without a stamp returns NULL
--    rather than assigning a txid. Confirm both run inside the SAME transaction as the
--    money definer (the /admin route wraps begin + money-definer in one tx).
--  * DEFINER_INTENT: auth_begin_finance 'app', auth_finance_admin_for_txn 'app'.
--  * Integration test: a non-platform-admin calling auth_begin_finance() raises 42501;
--    a money definer with no prior auth_begin_finance in the txn refuses; the stamp
--    does not leak to a later transaction (new txid -> NULL).
