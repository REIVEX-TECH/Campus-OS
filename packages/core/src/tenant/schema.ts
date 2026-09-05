import { z } from 'zod';

/** A tenant slug: lowercase, url-safe, and permanent (see CLAUDE.md §4). */
export const slugSchema = z
  .string()
  .min(1)
  .max(63)
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, 'slug must be lowercase alphanumeric with hyphens');

const hexColor = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'must be a hex colour like #0a7cff');

const emailDomain = z
  .string()
  .regex(
    /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i,
    'must be a bare domain, e.g. lgu.edu.pk',
  );

export const brandingSchema = z.object({
  colors: z
    .object({
      primary: hexColor,
      background: hexColor.optional(),
      foreground: hexColor.optional(),
    })
    .catchall(hexColor),
  logoPath: z.string().min(1),
});

export const seoSchema = z.object({
  /** Template applied to per-page titles; must contain the `%s` placeholder. */
  titleTemplate: z.string().includes('%s'),
  description: z.string().min(1),
  keywords: z.array(z.string().min(1)).default([]),
  /** Additional hostnames this tenant is reachable at (for canonical/SEO). */
  aliases: z.array(z.string().min(1)).default([]),
});

/**
 * How someone becomes a member of this tenant.
 *
 * `domain` lets anyone with a verified email on `allowedEmailDomains` join as a
 * student with no admin involvement, which is what a university with a single
 * well known address space wants. `invite` requires a tenant admin to invite
 * each member, for a tenant that would rather approve who gets in.
 *
 * Defaults to `domain`, matching how the first tenant already works. Nothing
 * enforces it yet: membership arrives with the identity module, and this field
 * exists so the setting is part of the tenant model from the start rather than
 * bolted on later.
 */
export const joinModeSchema = z.enum(['domain', 'invite']);

export const tenantConfigSchema = z.object({
  slug: slugSchema,
  displayName: z.string().min(1),
  /** Alternate slugs that also resolve to this tenant. */
  aliases: z.array(slugSchema).default([]),
  /** IANA timezone, e.g. "Asia/Karachi". */
  timezone: z.string().min(1),
  /** BCP-47 locale, e.g. "en" or "ur-PK". */
  locale: z.string().min(1),
  /**
   * How times are shown: "1:30 PM" or "13:30". Presentation only; storage is
   * always local wall-clock "HH:MM". A tenant setting because it is a cultural
   * convention of the university, not of the platform.
   */
  timeFormat: z.enum(['12h', '24h']).default('12h'),
  branding: brandingSchema,
  allowedEmailDomains: z.array(emailDomain).default([]),
  joinMode: joinModeSchema.default('domain'),
  enabledModules: z.array(z.string().min(1)).default([]),
  /**
   * Settings per module, keyed by module id and validated by that module's own
   * `settingsSchema` when read. Unknown modules are kept as they are so a
   * setting for a module that is disabled today survives a round trip.
   */
  moduleSettings: z.record(z.string(), z.unknown()).default({}),
  seo: seoSchema,
});

export type JoinMode = z.infer<typeof joinModeSchema>;
export type TenantConfig = z.infer<typeof tenantConfigSchema>;
export type TenantConfigInput = z.input<typeof tenantConfigSchema>;
