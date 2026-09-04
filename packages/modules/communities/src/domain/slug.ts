/** A community slug: lower case words joined by hyphens, 3 to 40 characters. */
export const COMMUNITY_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;

/** The slug a community takes from its name: "CS Freshers 2026" becomes "cs-freshers-2026". */
export function communitySlugFromName(name: string): string | null {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return COMMUNITY_SLUG_PATTERN.test(slug) ? slug : null;
}

/** The readable tail of a post's permalink: never used to look the post up. */
export function titleSlug(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60)
      .replace(/-+$/g, '') || 'post'
  );
}
