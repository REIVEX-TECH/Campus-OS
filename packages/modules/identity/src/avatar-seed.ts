/**
 * The seeds a person's avatar can be drawn from.
 *
 * A seed is only ever a string the avatar route turns into a picture, so its one
 * job is to be something that route will accept: letters, digits, underscore,
 * dot and hyphen. The first version joined the user id and the time with a colon,
 * which the route refuses, so every avatar it produced quietly 404ed to a bare
 * backdrop. A contract test in the web app pins the two together.
 *
 * Seeds are numbered rather than free text, and the number is all a caller ever
 * sends: the server builds the seed itself, so a chosen avatar is always one of
 * this user's own options and never an arbitrary string from a browser. Pure, so
 * every part of it can be tested without a database.
 */

/** How many options a page of the picker shows. */
export const AVATAR_OPTIONS_PER_PAGE = 12;

/**
 * The highest option number that exists. Bounded so a seed cannot be made
 * arbitrarily long, and generous enough that shuffling never runs out: fifty
 * pages of twelve.
 */
export const AVATAR_OPTION_MAX = AVATAR_OPTIONS_PER_PAGE * 50 - 1;

/** Whether a number names one of the options. */
export function isAvatarOption(option: number): boolean {
  return Number.isInteger(option) && option >= 0 && option <= AVATAR_OPTION_MAX;
}

/**
 * The seed for one option. The same person always sees the same picture at the
 * same number, so a reader can shuffle past one and come back to it.
 */
export function avatarOptionSeed(userId: string, option: number): string {
  return `${userId}.${option}`;
}

/** How many pages of options there are, for wrapping the shuffle. */
export const AVATAR_OPTION_PAGES = Math.ceil((AVATAR_OPTION_MAX + 1) / AVATAR_OPTIONS_PER_PAGE);

/** One page of options, as option numbers. Wraps, so shuffling never dead ends. */
export function avatarOptionPage(page: number): number[] {
  const wrapped = ((page % AVATAR_OPTION_PAGES) + AVATAR_OPTION_PAGES) % AVATAR_OPTION_PAGES;
  const first = wrapped * AVATAR_OPTIONS_PER_PAGE;
  return Array.from({ length: AVATAR_OPTIONS_PER_PAGE }, (_, i) => first + i).filter(
    isAvatarOption,
  );
}
