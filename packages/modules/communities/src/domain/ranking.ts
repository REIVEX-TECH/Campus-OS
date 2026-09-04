/**
 * Ranking, precomputed on write so reads are index order.
 *
 * All pure. The stored columns are `hot_score` and `controversy` on posts, and
 * `best_score` and `controversy` on comments; each is recomputed in the same
 * transaction as the vote or the creation that changed it.
 */

/** Reddit's epoch, kept so scores read like the ones people know. */
const EPOCH_SECONDS = 1_134_028_003;

/**
 * Reddit's hot: `sign(s) · log10(max(|s|, 1)) + seconds / 45000`. Ten votes are
 * worth as much as being twelve and a half hours newer.
 */
export function hotScore(upVotes: number, downVotes: number, createdAt: Date): number {
  const s = upVotes - downVotes;
  const order = Math.log10(Math.max(Math.abs(s), 1));
  const sign = s > 0 ? 1 : s < 0 ? -1 : 0;
  const seconds = createdAt.getTime() / 1000 - EPOCH_SECONDS;
  return Math.round((sign * order + seconds / 45_000) * 1e7) / 1e7;
}

/**
 * Reddit's controversy: `(up + down) ^ (min / max)`, zero unless both sides
 * voted. A 50/50 split on many votes ranks highest.
 */
export function controversyScore(upVotes: number, downVotes: number): number {
  if (upVotes <= 0 || downVotes <= 0) return 0;
  const magnitude = upVotes + downVotes;
  const balance = upVotes > downVotes ? downVotes / upVotes : upVotes / downVotes;
  return Math.round(magnitude ** balance * 1e7) / 1e7;
}

/**
 * The lower bound of the Wilson score interval at 80% confidence, Reddit's
 * "best" for comments: a comment with 3 up and 0 down does not outrank one with
 * 60 up and 10 down.
 */
export function wilsonLowerBound(upVotes: number, downVotes: number, z = 1.281551565545): number {
  const n = upVotes + downVotes;
  if (n === 0) return 0;
  const p = upVotes / n;
  const left = p + (z * z) / (2 * n);
  const right = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  const under = 1 + (z * z) / n;
  return Math.round(((left - right) / under) * 1e7) / 1e7;
}

/** What one vote change does to the tallies. `previous` and `next` are -1, 0 or 1. */
export function applyVote(
  tally: { upVotes: number; downVotes: number },
  previous: -1 | 0 | 1,
  next: -1 | 0 | 1,
): { upVotes: number; downVotes: number; score: number } {
  let { upVotes, downVotes } = tally;
  if (previous === 1) upVotes -= 1;
  if (previous === -1) downVotes -= 1;
  if (next === 1) upVotes += 1;
  if (next === -1) downVotes += 1;
  return { upVotes, downVotes, score: upVotes - downVotes };
}
