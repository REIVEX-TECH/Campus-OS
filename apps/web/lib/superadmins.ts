/**
 * `SUPERADMIN_EMAILS`: the addresses that may become platform admins.
 *
 * The environment names who MAY be one; a `platform_roles` row records who IS,
 * written once at sign in. Comma, semicolon or whitespace separated; case does
 * not matter. Read on each sign in rather than at boot, so a change lands with
 * the next process without a rebuild. This is the bootstrap for platform
 * administration and nothing else reads it.
 */
/**
 * A real address, not merely a string with an "@" in it. `foo@` and a bare "@"
 * both contain one and are not addresses; admitting them would put a matchable
 * junk entry on the allowlist. One "@", something either side, and a dot in the
 * domain. The database definer that actually grants the role validates each
 * entry the same way (0016), so a bad entry cannot promote anyone even if it
 * reaches the list; this keeps it off the list in the first place.
 */
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function parseEmailList(value: string | undefined): string[] {
  return (value ?? '')
    .split(/[\s,;]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => EMAIL.test(s));
}

export function superadminEmails(): string[] {
  return parseEmailList(process.env.SUPERADMIN_EMAILS);
}
