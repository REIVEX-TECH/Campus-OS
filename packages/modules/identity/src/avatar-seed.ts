/**
 * The seed a re rolled avatar is drawn from.
 *
 * A seed is only ever a string the avatar route turns into a picture, so its one
 * job is to be something that route will accept: letters, digits, underscore,
 * dot and hyphen. The first version joined the user id and the time with a colon,
 * which the route refuses, so every re rolled avatar quietly 404ed to a bare
 * backdrop. A contract test in the web app now pins the two together.
 *
 * Pure, so it can be tested without a clock or a database. The caller passes the
 * moment; a user re rolling twice in the same millisecond gets the same picture
 * back, which is harmless.
 */
export function nextAvatarSeed(userId: string, now: number): string {
  return `${userId}.${now}`;
}
