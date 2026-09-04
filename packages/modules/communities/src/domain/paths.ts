/**
 * Comment trees as materialised paths: a comment's path is its ancestors' ids
 * and its own, dotted, so one indexed range read returns a whole subtree in
 * tree order and depth is the number of dots.
 */

export const DEFAULT_DEPTH_CAP = 8;

/** The path of a reply under `parentPath`, or a root comment's own id. */
export function childPath(parentPath: string | null, id: string): string {
  return parentPath ? `${parentPath}.${id}` : id;
}

/** Root comments are depth 0. */
export function depthOf(path: string): number {
  return path.split('.').length - 1;
}

/** Whether a reply may be added under a comment at this depth. */
export function canReplyAt(parentDepth: number, cap = DEFAULT_DEPTH_CAP): boolean {
  return parentDepth + 1 <= cap;
}

/** Whether `candidate` is inside the subtree rooted at `ancestorPath`. */
export function isWithin(ancestorPath: string, candidate: string): boolean {
  return candidate === ancestorPath || candidate.startsWith(`${ancestorPath}.`);
}
