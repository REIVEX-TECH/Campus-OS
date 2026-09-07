import { z } from 'zod';
import { PACKAGE_TIERS } from './manifest';

/**
 * What a person submits to create or edit a gig. Validated at the write boundary.
 * A gig carries one to three packages (tiers). The contact-info guardrail from
 * goods applies to gig and package text too: buyers reach a seller through the
 * messages / order chat, not a phone number pasted into a description.
 */
export const packageInputSchema = z.object({
  tier: z.enum(PACKAGE_TIERS),
  title: z.string().trim().min(2).max(80),
  description: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .transform((v) => (v ? v : undefined)),
  /** Integer paisa (PKR). Must be > 0; the upper cap is a setting. */
  pricePaisa: z.number().int().min(1),
  deliveryDays: z.number().int().min(1),
  revisions: z.number().int().min(0),
});

export type PackageInput = z.infer<typeof packageInputSchema>;

export const gigInputSchema = z.object({
  title: z.string().trim().min(5).max(140),
  description: z
    .string()
    .trim()
    .max(6000)
    .optional()
    .transform((v) => (v ? v : undefined)),
  category: z.string().min(1).max(40),
  packages: z.array(packageInputSchema).min(1).max(3),
});

export type GigInput = z.infer<typeof gigInputSchema>;

/** True if the packages hold two rows with the same tier (tiers must be distinct). */
export function hasDuplicateTiers(packages: { tier: string }[]): boolean {
  return new Set(packages.map((p) => p.tier)).size !== packages.length;
}
