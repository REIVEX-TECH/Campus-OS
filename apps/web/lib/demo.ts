/**
 * Demo tenant read-only rule (see docs/design-demo-tenant.md, H).
 *
 * On a demo tenant, only seeded personas (`actor.isDemo`) may mutate; every real
 * signed-in user is read-only. This is enforced server-side, in every mutation gate,
 * so hitting the API directly does not get around it. Reads are untouched: read gates
 * and server-component reads never call this.
 *
 * Both inputs are unforgeable by a real user: `tenant.isDemo` comes from the tenant
 * config (platform-admin-write), and `actor.isDemo` from the user's own row, which a
 * RESTRICTIVE policy stops the app role from ever setting true (identity 0034).
 */
export function demoReadOnly(
  tenant: { isDemo: boolean },
  actor: { isDemo: boolean },
): Response | null {
  if (tenant.isDemo && !actor.isDemo) {
    return Response.json({ error: 'demo_read_only' }, { status: 403 });
  }
  return null;
}
