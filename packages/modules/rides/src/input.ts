import { z } from 'zod';

/**
 * Contact details in free text turn a ride board into an off-platform-contact and
 * fee-negotiation channel, which the no-money guarantee forbids (see
 * docs/design-rides.md). Detect an email, a messaging-app handle, or a phone
 * number (a run of 7+ digits allowing spaces, dashes, dots, parens and a leading
 * +), and refuse the note. Coordination happens in the in-app conversation the
 * accept flow opens.
 */
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const MESSAGING_APP =
  /\b(whats\s*app|wa\.me|telegram|t\.me|signal|viber|imo|insta(gram)?|snap(chat)?)\b/i;
const PHONE = /(?:\+?\d[\s().-]?){7,}\d/;

export function containsContactInfo(text: string): boolean {
  return EMAIL.test(text) || MESSAGING_APP.test(text) || PHONE.test(text);
}

const notes = z
  .string()
  .trim()
  .max(2000)
  .refine((v) => !containsContactInfo(v), { message: 'contact_info' })
  .optional()
  .transform((v) => (v ? v : undefined));

const recurrence = z
  .object({
    /** ISO-8601 weekdays (1 = Monday). */
    weekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7),
    /** Wall-clock departure time, interpreted through the tenant timezone. */
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  })
  .optional();

const place = z.string().trim().min(2).max(120);
const coord = z.number().finite().optional();

/** What a person submits to post a ride. Validated at the write boundary. */
export const rideInputSchema = z
  .object({
    kind: z.enum(['offer', 'request']),
    originText: place,
    destText: place,
    /** ISO datetime; the write path checks it is in the future. */
    departAt: z.string().datetime({ offset: true }),
    /** Offers only; capped against the tenant's maxSeatsPerOffer in the service. */
    seats: z.number().int().min(1).max(8).optional(),
    notes,
    womenOnly: z.boolean().default(false),
    recurrence,
    originLat: coord,
    originLng: coord,
    destLat: coord,
    destLng: coord,
  })
  .refine((v) => (v.kind === 'offer' ? typeof v.seats === 'number' : v.seats === undefined), {
    message: 'seats',
    path: ['seats'],
  })
  .refine((v) => v.kind === 'offer' || v.recurrence === undefined, {
    message: 'recurrence',
    path: ['recurrence'],
  });

export type RideInput = z.infer<typeof rideInputSchema>;
