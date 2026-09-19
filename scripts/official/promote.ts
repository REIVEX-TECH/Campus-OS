import type { Sql } from 'postgres';

/**
 * Promote an account to a first-party official account, or demote it.
 *
 * is_official cannot be written by the application role (identity 0035's RESTRICTIVE
 * policy, §8), so this is the sanctioned owner-run path: run as the migration/owner
 * role, it sets the flag directly. An official account may post in any community
 * (subject to the content rules) and carries the "Official" badge. See
 * docs/runbooks/official-account.md.
 *
 * The account must already exist (it has signed in at least once). The handle is
 * matched case-insensitively through the public-profile view, exactly as the app
 * resolves a profile.
 */
export async function setOfficial(
  sql: Sql,
  opts: { tenant: string; handle: string; official?: boolean },
): Promise<{ userId: string; handle: string; official: boolean }> {
  const target = opts.official !== false;
  // Resolve the account by handle in tenant context, the same read the app uses.
  await sql`select set_config('app.tenant_id', ${opts.tenant}, false)`;
  const found = (await sql`
    select user_id, handle from public_profiles
    where lower(handle) = lower(${opts.handle}) limit 1`) as { user_id: string; handle: string }[];
  await sql`select set_config('app.tenant_id', '', false)`;
  if (found.length === 0) {
    throw new Error(`no active account with handle "${opts.handle}" (has it signed in?)`);
  }
  const userId = found[0]!.user_id;
  // The write is an own-row update: own_user (0001) matches on app.user_id, and the
  // owner role is exempt from the app-scoped RESTRICTIVE policy, so it may set the flag.
  await sql`select set_config('app.user_id', ${userId}, false)`;
  const updated = (await sql`
    update users set is_official = ${target} where id = ${userId}::uuid returning id`) as {
    id: string;
  }[];
  await sql`select set_config('app.user_id', '', false)`;
  if (updated.length === 0) throw new Error('promotion did not apply (row-level security)');
  return { userId, handle: found[0]!.handle, official: target };
}
