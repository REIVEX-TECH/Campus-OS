/**
 * Bar heights as whole percentages of the largest value. A day with nothing is
 * 0; a day with anything at all is at least a sliver, so "one sign in" is
 * visible next to "forty". All zero when nothing happened.
 */
export function scaleToPercent(values: readonly number[]): number[] {
  const max = Math.max(0, ...values);
  if (max === 0) return values.map(() => 0);
  return values.map((v) => (v <= 0 ? 0 : Math.max(4, Math.round((v / max) * 100))));
}
