import { z } from 'zod';

/**
 * Contact information does not belong in a listing: buyers reach a seller through
 * the in-app messages module, which is where blocking, reporting and the audit
 * trail live. A run of 7+ digits (allowing spaces, dashes, parens and a leading
 * +) reads as a phone number; "whatsapp" / "wa.me" reads as a handle. This is a
 * usability guardrail, not a security boundary (moderation is the boundary).
 */
const PHONE_RE = /(?:\+?\d[\s().-]?){7,}/;
const WHATSAPP_RE = /whats\s?app|wa\.me|\bwapp\b/i;

export function hasContactInfo(text: string | undefined | null): boolean {
  if (!text) return false;
  return PHONE_RE.test(text) || WHATSAPP_RE.test(text);
}

/** What a person submits to create a goods listing. Validated at the write boundary. */
export const listingInputSchema = z.object({
  title: z.string().trim().min(3).max(140),
  description: z
    .string()
    .trim()
    .max(4000)
    .optional()
    .transform((v) => (v ? v : undefined)),
  /** Integer paisa (PKR). 0 is allowed (a giveaway); the upper cap is a setting. */
  pricePaisa: z.number().int().min(0),
  priceKind: z.enum(['fixed', 'negotiable']).default('fixed'),
  category: z.string().min(1).max(40),
  condition: z.enum(['new', 'like-new', 'used', 'for-parts']),
  meetupPref: z
    .string()
    .trim()
    .max(120)
    .optional()
    .transform((v) => (v ? v : undefined)),
});

export type ListingInput = z.infer<typeof listingInputSchema>;
