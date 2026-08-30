import { z } from 'zod';

/** A single class parsed from the #table-time HTML, validated at the parse
 * boundary (CLAUDE.md §5) before it becomes a normalized entry. */
export const parsedSlotSchema = z.object({
  day: z.number().int().min(1).max(7),
  startsAt: z.string().regex(/^\d{2}:\d{2}$/),
  endsAt: z.string().regex(/^\d{2}:\d{2}$/),
  subject: z.string().min(1),
  room: z.string().min(1).nullable(),
  teacher: z.string().min(1).nullable(),
});

export type ParsedSlot = z.infer<typeof parsedSlotSchema>;
