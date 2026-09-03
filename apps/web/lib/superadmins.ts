/**
 * `SUPERADMIN_EMAILS`: the addresses that may become platform admins.
 *
 * The environment names who MAY be one; a `platform_roles` row records who IS,
 * written once at sign in. Comma, semicolon or whitespace separated; case does
 * not matter. Read on each sign in rather than at boot, so a change lands with
 * the next process without a rebuild. This is the bootstrap for platform
 * administration and nothing else reads it.
 */
export function parseEmailList(value: string | undefined): string[] {
  return (value ?? '')
    .split(/[\s,;]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.includes('@'));
}

export function superadminEmails(): string[] {
  return parseEmailList(process.env.SUPERADMIN_EMAILS);
}
