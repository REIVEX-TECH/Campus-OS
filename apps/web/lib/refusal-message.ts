/**
 * A refusal as something to read, with the numbers when it carries any.
 *
 * Every refusal in the communities module is a bare code, and the message for
 * it is a fixed sentence. A participation gate is the exception: it answers
 * with what the community asks for and what the person has, and a message that
 * says "you need 50 and have 12" is worth far more than "you cannot".
 */
export function refusalMessage(
  errors: Record<string, string>,
  body: { error?: string; need?: number; have?: number },
): string {
  const text = errors[body.error ?? ''] ?? errors.failed ?? '';
  if (typeof body.need !== 'number' || typeof body.have !== 'number') return text;
  return text.replace('{need}', String(body.need)).replace('{have}', String(body.have));
}
