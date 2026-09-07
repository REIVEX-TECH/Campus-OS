/**
 * Money formatting. Amounts are integer paisa (1 PKR = 100 paisa) everywhere in
 * the domain; this is the only place they become a display string. Whole-rupee
 * amounts show no decimals; a fractional amount shows two.
 */
export function formatPkr(paisa: number): string {
  const rupees = paisa / 100;
  return new Intl.NumberFormat('en-PK', {
    style: 'currency',
    currency: 'PKR',
    currencyDisplay: 'narrowSymbol',
    minimumFractionDigits: 0,
    maximumFractionDigits: paisa % 100 === 0 ? 0 : 2,
  }).format(rupees);
}

/** Parse a user-entered PKR amount (rupees, optional decimals) into integer paisa,
 *  or null if it is not a valid non-negative number. */
export function parsePkrToPaisa(input: string): number | null {
  const trimmed = input.trim().replace(/,/g, '');
  if (trimmed === '') return null;
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const rupees = Number(trimmed);
  if (!Number.isFinite(rupees) || rupees < 0) return null;
  return Math.round(rupees * 100);
}
