-- A standing that has run out is not a standing, here too.
--
-- Identity 0014 gave `auth_effective_permissions` one clause: a restriction or
-- suspension whose `standing_until` has passed stops counting, because nothing
-- runs on a schedule to notice that an hour is up. This resolver keeps its own
-- copy of the same question and was never told, so the two disagreed.
--
-- The tenant half of this function delegates and so already honoured a lapse;
-- the community half compared `tm.status` literally. A person whose suspension
-- ran out therefore got their tenant permissions back and none of the roles
-- they hold in a community, which reads as being half unbanned: they could see
-- the page and not use it, until an administrator lifted by hand something that
-- had already ended.
--
-- Recreated whole rather than patched, because a function is replaced whole;
-- everything else here is exactly as 0000 wrote it.
CREATE OR REPLACE FUNCTION auth_effective_community_permissions(p_user_id uuid, p_tenant_id text, p_community_id uuid)
	RETURNS TABLE (permission text)
	LANGUAGE sql
	STABLE
	SECURITY DEFINER
	SET search_path = public
AS $$
	WITH banned AS (
		SELECT 1
		FROM community_bans b
		WHERE b.user_id = p_user_id
		  AND b.tenant_id = p_tenant_id
		  AND (b.community_id = p_community_id OR b.community_id IS NULL)
		  AND b.lifted_at IS NULL
		  AND (b.until IS NULL OR b.until > now())
	)
	SELECT permission FROM auth_effective_permissions(p_user_id, p_tenant_id)
	WHERE NOT EXISTS (SELECT 1 FROM banned)
	UNION
	SELECT rp.permission
	FROM community_memberships cm
	JOIN community_member_roles cmr ON cmr.membership_id = cm.id
	JOIN role_permissions rp ON rp.role_id = cmr.role_id
	JOIN tenant_memberships tm ON tm.user_id = cm.user_id AND tm.tenant_id = cm.tenant_id
	WHERE cm.user_id = p_user_id
	  AND cm.tenant_id = p_tenant_id
	  AND cm.community_id = p_community_id
	  AND cm.left_at IS NULL
	  AND (tm.status = 'active' OR (tm.standing_until IS NOT NULL AND tm.standing_until <= now()))
	  AND NOT EXISTS (SELECT 1 FROM banned);
$$;
