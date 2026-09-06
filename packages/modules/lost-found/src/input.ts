import { z } from 'zod';

/** What a person submits to report an item. Validated at the write boundary. */
export const itemInputSchema = z.object({
  kind: z.enum(['lost', 'found']),
  title: z.string().trim().min(3).max(140),
  description: z
    .string()
    .trim()
    .max(4000)
    .optional()
    .transform((v) => (v ? v : undefined)),
  category: z.string().min(1).max(40),
  locationText: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((v) => (v ? v : undefined)),
  buildingId: z.string().uuid().optional(),
  happenedOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export type ItemInput = z.infer<typeof itemInputSchema>;
