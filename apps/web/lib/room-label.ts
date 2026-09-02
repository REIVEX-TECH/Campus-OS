/**
 * The short mark shown on a room's generated avatar. Room names from the import
 * read like "Room 26 NB" or "Lab 18 OB", where the number is what people
 * actually say, so lead with it when there is one and fall back to initials.
 */
export function roomInitials(name: string): string {
  const number = name.match(/\d+/)?.[0];
  if (number) return number.slice(0, 3);
  const letters = name.replace(/[^\p{L}]/gu, '');
  return (letters.slice(0, 2) || '?').toUpperCase();
}
