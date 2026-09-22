-- Which timetable contextual chips a person has dismissed, per day.
--
-- A chip is a small, specific nudge under the timetable schedule (see
-- docs/design-timetable-chips.md). It is dismissible per user per chip_kind per day:
-- once dismissed, that kind does not reappear until tomorrow, and the next-ranked chip
-- takes its place. The `feedback-onetime` card reuses this table under a synthetic
-- chip_kind with a fixed sentinel date, so "ever" is one row.
--
-- Per account, like verify_prompt_dismissed (0027) and card_dismissals (0036): the
-- person's own low-stakes preference, keyed on app.user_id by RLS. The write goes
-- through a definer that stamps user_id/tenant_id from the GUCs, so the caller supplies
-- only the chip_kind and cannot even name another user's row. This is a self-write, not
-- an authorization decision, so keying the stamp on app.user_id is acceptable
-- (CLAUDE.md 8): the definer grants no privilege, it only records the caller's own
-- dismissal. The read is an ordinary own-row RLS select.
CREATE TABLE "timetable_chip_dismissals" (
	"user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"tenant_id" text NOT NULL REFERENCES "universities"("slug") ON DELETE CASCADE,
	"chip_kind" text NOT NULL,
	"dismissed_on" date NOT NULL,
	PRIMARY KEY ("user_id", "tenant_id", "chip_kind", "dismissed_on")
);
--> statement-breakpoint
ALTER TABLE "timetable_chip_dismissals" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "timetable_chip_dismissals" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "own_timetable_chip_dismissals" ON "timetable_chip_dismissals"
	USING ("user_id"::text = current_setting('app.user_id', true))
	WITH CHECK ("user_id"::text = current_setting('app.user_id', true));
--> statement-breakpoint

-- The self-write definer: stamps user_id + tenant_id from the GUCs and the day from the
-- server clock, so the application supplies only which chip it dismissed. ON CONFLICT DO
-- NOTHING makes a repeat dismissal a no-op. It still satisfies the own-row WITH CHECK
-- above (user_id = app.user_id), so it grants nothing the app could not already write to
-- its own row; it only removes the chance to fumble another user_id.
CREATE OR REPLACE FUNCTION record_timetable_chip_dismissal(p_chip_kind text)
	RETURNS void
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET search_path = public
AS $$
DECLARE
	v_user uuid := nullif(current_setting('app.user_id', true), '')::uuid;
	v_tenant text := nullif(current_setting('app.tenant_id', true), '');
BEGIN
	IF v_user IS NULL OR v_tenant IS NULL THEN
		RAISE EXCEPTION 'record_timetable_chip_dismissal: no actor/tenant context'
			USING ERRCODE = '42501';
	END IF;
	IF p_chip_kind IS NULL OR length(p_chip_kind) = 0 OR length(p_chip_kind) > 64 THEN
		RAISE EXCEPTION 'record_timetable_chip_dismissal: bad chip_kind' USING ERRCODE = '22023';
	END IF;
	INSERT INTO timetable_chip_dismissals (user_id, tenant_id, chip_kind, dismissed_on)
	VALUES (v_user, v_tenant, p_chip_kind, current_date)
	ON CONFLICT DO NOTHING;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION record_timetable_chip_dismissal(text) FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'campusos_app') THEN
		EXECUTE 'GRANT EXECUTE ON FUNCTION record_timetable_chip_dismissal(text) TO campusos_app';
	END IF;
END
$$;
