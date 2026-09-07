import { z } from 'zod';

/** What a buyer submits to place an order. Validated at the write boundary. */
export const placeOrderInputSchema = z.object({
  gigId: z.string().uuid(),
  packageId: z.string().uuid(),
  /** 'cash' (pay on delivery) or 'online' (the money module, when enabled). */
  paymentMode: z.enum(['cash', 'online']).default('cash'),
  requirements: z
    .string()
    .trim()
    .max(4000)
    .optional()
    .transform((v) => (v ? v : undefined)),
});

/** The caller's input (paymentMode/requirements optional; the schema fills them). */
export type PlaceOrderInput = z.input<typeof placeOrderInputSchema>;

/** What a buyer submits to review a completed order. */
export const reviewInputSchema = z.object({
  rating: z.number().int().min(1).max(5),
  body: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .transform((v) => (v ? v : undefined)),
});

export type ReviewInput = z.infer<typeof reviewInputSchema>;

/** The status an order may move to, and who may ask for it. The database is the
 *  authority (mkt_order_transition); this list is for typing the API surface. */
export const ORDER_TARGET_STATUSES = [
  'awaiting_payment',
  'paid',
  'in_progress',
  'delivered',
  'completed',
  'cancelled',
  'disputed',
] as const;
export type OrderTargetStatus = (typeof ORDER_TARGET_STATUSES)[number];
