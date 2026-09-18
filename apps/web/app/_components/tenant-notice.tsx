/**
 * A site-wide notice banner shown at the top of every tenant page when the tenant
 * config carries a `notice` (today, only the demo tenant, to say its content is
 * illustrative). Presentational and server-rendered; the copy comes from the tenant
 * config, never hardcoded here.
 */
export function TenantNotice({ message }: { message: string }) {
  return (
    <div
      role="status"
      className="rounded-2xl border border-warning/40 bg-warning/10 px-4 py-3 text-[13px] font-medium text-foreground"
    >
      {message}
    </div>
  );
}
