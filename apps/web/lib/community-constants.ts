/**
 * Communities constants a client bundle may import: pure, no database, no
 * module code. The server validates against the module's own definitions.
 */

export const REPORT_REASONS = [
  'harassment',
  'hate',
  'adult',
  'personal_information',
  'threats',
  'spam',
  'misinformation',
  'community_rule',
  'other',
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number];

/** The readable tail of a post's permalink; never used to look the post up. */
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

export function postPath(
  base: string,
  communitySlug: string,
  postId: string,
  title: string,
): string {
  return `${base}/c/${communitySlug}/post/${postId}/${titleSlug(title)}`;
}
