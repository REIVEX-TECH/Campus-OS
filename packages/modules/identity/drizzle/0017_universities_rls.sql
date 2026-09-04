-- universities gets row-level security, at last.
--
-- It is the parent every tenant-scoped table hangs off: 25 foreign keys
-- reference `universities(slug)` and every one of them is ON DELETE CASCADE. Yet
-- the table had no RLS at all, and `scripts/db-grants.sql` grants the
-- application SELECT/INSERT/UPDATE/DELETE on every table, so any code path in
-- any tenant context -- or none -- could rename, retime, or DELETE a university,
-- and a delete would take every community, post, comment, membership and audit
-- row of that university down with it. Nothing in the application does this; the
-- database simply permitted it. This closes that.
--
-- Modelled exactly on `tenant_configs` (0012), its sibling: the row is public to
-- read (the landing page lists every university, and a tenant page reads its
-- own), and only a platform administrator may write it. A university and its
-- config are created together by `createTenant`, which runs as the platform
-- admin, so the same predicate admits both writes.
--
-- Lives in the identity module, not the base folder, because it references
-- `platform_roles` (identity) and the base folder is frozen; identity already
-- owns the matching `tenant_configs` policies and its own migration bookkeeping.

ALTER TABLE "universities" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- No FORCE. The owner must be able to write it (createTenant's insert runs as
-- the app role, but the SECURITY DEFINER functions that iterate every tenant --
-- the karma rebuild, the role-template sync -- read `universities` as the owner,
-- and FORCE would filter the owner out and break them). The application is a
-- non-owner in a split database, so the policies below bind it regardless of
-- FORCE; FORCE would only add a net that the definers cannot live behind.
ALTER TABLE "universities" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Public to read: a university's slug and name are how the platform lists it.
CREATE POLICY "universities_read" ON "universities" FOR SELECT USING (true);
--> statement-breakpoint

-- Written only by a platform administrator. createTenant/updateTenantConfig run
-- `withActorInTenant(<platform admin>, slug)`, so `app.user_id` is the admin and
-- this predicate is satisfied; for anyone else it is not, and the write fails.
CREATE POLICY "universities_platform_insert" ON "universities" FOR INSERT
	WITH CHECK (
		EXISTS (
			SELECT 1 FROM platform_roles pr
			WHERE pr.user_id::text = current_setting('app.user_id', true)
			  AND pr.role = 'platform_admin'
		)
	);
--> statement-breakpoint
CREATE POLICY "universities_platform_update" ON "universities" FOR UPDATE
	USING (
		EXISTS (
			SELECT 1 FROM platform_roles pr
			WHERE pr.user_id::text = current_setting('app.user_id', true)
			  AND pr.role = 'platform_admin'
		)
	)
	WITH CHECK (
		EXISTS (
			SELECT 1 FROM platform_roles pr
			WHERE pr.user_id::text = current_setting('app.user_id', true)
			  AND pr.role = 'platform_admin'
		)
	);
--> statement-breakpoint

-- No DELETE policy, so DELETE is default-denied to the application role
-- entirely, platform admin or not. Deleting a university cascades to everything
-- and tenant deletion is not a built feature; when it is, it will be a
-- deliberate, audited act, not a row the app role can drop. Until then a
-- platform administrator who must remove a tenant does it as the owner, by
-- runbook. `tenant_configs` withholds DELETE the same way.
