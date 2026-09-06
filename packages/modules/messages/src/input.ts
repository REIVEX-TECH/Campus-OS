import { z } from 'zod';

/** A new message: a non-empty body and an optional reply-to. Length is checked
 * against the tenant's `maxBodyLength` in the service, where the setting lives. */
export const sendInputSchema = z.object({
  body: z.string().trim().min(1),
  replyToId: z.string().uuid().optional(),
});

export type SendInput = z.infer<typeof sendInputSchema>;

/** An edit: a new non-empty body for one's own message. */
export const editInputSchema = z.object({
  body: z.string().trim().min(1),
});

export type EditInput = z.infer<typeof editInputSchema>;
