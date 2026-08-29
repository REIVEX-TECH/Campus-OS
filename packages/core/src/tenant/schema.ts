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

export const tenantConfigSchema = z.object({
  slug: slugSchema,
  displayName: z.string().min(1),
  /** Alternate slugs that also resolve to this tenant. */
  aliases: z.array(slugSchema).default([]),
  /** IANA timezone, e.g. "Asia/Karachi". */
  timezone: z.string().min(1),
  /** BCP-47 locale, e.g. "en" or "ur-PK". */
  locale: z.string().min(1),
  branding: brandingSchema,
  allowedEmailDomains: z.array(emailDomain).default([]),
  enabledModules: z.array(z.string().min(1)).default([]),
  seo: seoSchema,
});

export type TenantConfig = z.infer<typeof tenantConfigSchema>;
export type TenantConfigInput = z.input<typeof tenantConfigSchema>;
