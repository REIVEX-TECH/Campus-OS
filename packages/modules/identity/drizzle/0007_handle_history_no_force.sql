-- handle_history drops FORCE, the last table that needed to.
--
-- Same reason as sessions in 0002 and users in 0004. FORCE applies a policy to
-- the table's OWNER, which mattered only while the application connected as the
-- owner. It no longer does, so the own-row policy binds the application either
-- way and nothing it can see changes here.
--
-- What it fixes is auth_handle_is_reserved (0005). A released handle is held for
-- a window so nobody can pick up a name someone just left and be mistaken for
-- them, but the history rows belong to their FORMER owner, so the person asking
-- cannot read them under the own-row policy. The definer function exists to
-- answer that one yes or no question, and with FORCE still set it was filtered
-- exactly as the caller would be: it always answered "not reserved", and the
-- reservation silently did nothing.
--
-- Every definer function now reads a table it can actually see. FORCE remains on
-- all tenant-scoped tables, where it is still a safety net if the application is
-- ever pointed at the owner credential.

ALTER TABLE "handle_history" NO FORCE ROW LEVEL SECURITY;
