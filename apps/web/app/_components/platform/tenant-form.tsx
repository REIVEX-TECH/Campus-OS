'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { buttonVariants } from '@campusos/ui';
import type { TenantConfig } from '@campusos/core/tenant';

/**
 * A university's configuration, as a form.
 *
 * The shape saved is the same validated config a file holds. Fields the form
 * does not show are carried over from what was loaded, so saving never drops
 * a setting it did not offer to change. Lists are typed as comma separated
 * text; the server validates everything again against the schema and says
 * which fields it refused.
 */

export type TenantFormLabels = {
  slug: string;
  displayName: string;
  timezone: string;
  locale: string;
  timeFormat: string;
  timeFormat12h: string;
  timeFormat24h: string;
  primaryColor: string;
  logoPath: string;
  aliases: string;
  allowedEmailDomains: string;
  joinMode: string;
  joinModeDomain: string;
  joinModeInvite: string;
  adminEmails: string;
  adminEmailsHint: string;
  enabledModules: string;
  seoTitleTemplate: string;
  seoDescription: string;
  seoKeywords: string;
  seoAliases: string;
  listHint: string;
  submit: string;
  working: string;
  done: string;
  exists: string;
  /** "{issues}" is replaced with what the server refused. */
  invalid: string;
  failed: string;
};

type Values = {
  slug: string;
  displayName: string;
  timezone: string;
  locale: string;
  timeFormat: '12h' | '24h';
  primaryColor: string;
  logoPath: string;
  aliases: string;
  allowedEmailDomains: string;
  joinMode: 'domain' | 'invite';
  adminEmails: string;
  enabledModules: string;
  seoTitleTemplate: string;
  seoDescription: string;
  seoKeywords: string;
  seoAliases: string;
};

type Status = { kind: 'idle' | 'working' } | { kind: 'done' | 'error'; message: string };

const list = (items: readonly string[]) => items.join(', ');
const unlist = (text: string) =>
  text
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

/** A colour input needs six hex digits; a config may hold three. */
function sixDigit(hex: string): string {
  const m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(hex);
  return m ? `#${m[1]}${m[1]}${m[2]}${m[2]}${m[3]}${m[3]}` : hex;
}

function fromConfig(c: TenantConfig): Values {
  return {
    slug: c.slug,
    displayName: c.displayName,
    timezone: c.timezone,
    locale: c.locale,
    timeFormat: c.timeFormat,
    primaryColor: sixDigit(c.branding.colors.primary),
    logoPath: c.branding.logoPath,
    aliases: list(c.aliases),
    allowedEmailDomains: list(c.allowedEmailDomains),
    joinMode: c.joinMode,
    adminEmails: list(c.adminEmails),
    enabledModules: list(c.enabledModules),
    seoTitleTemplate: c.seo.titleTemplate,
    seoDescription: c.seo.description,
    seoKeywords: list(c.seo.keywords),
    seoAliases: list(c.seo.aliases),
  };
}

function toConfig(base: TenantConfig, v: Values): TenantConfig {
  return {
    ...base,
    slug: v.slug.trim().toLowerCase(),
    displayName: v.displayName.trim(),
    timezone: v.timezone.trim(),
    locale: v.locale.trim(),
    timeFormat: v.timeFormat,
    branding: {
      ...base.branding,
      colors: { ...base.branding.colors, primary: v.primaryColor },
      logoPath: v.logoPath.trim(),
    },
    aliases: unlist(v.aliases),
    allowedEmailDomains: unlist(v.allowedEmailDomains),
    joinMode: v.joinMode,
    adminEmails: unlist(v.adminEmails),
    enabledModules: unlist(v.enabledModules),
    seo: {
      ...base.seo,
      titleTemplate: v.seoTitleTemplate,
      description: v.seoDescription.trim(),
      keywords: unlist(v.seoKeywords),
      aliases: unlist(v.seoAliases),
    },
  };
}

const field =
  'ios-field h-11 w-full rounded-xl px-3.5 text-[15px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
const area =
  'ios-field min-h-24 w-full rounded-xl px-3.5 py-2.5 text-[15px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

export function TenantForm({
  mode,
  initial,
  labels,
}: {
  mode: 'create' | 'edit';
  initial: TenantConfig;
  labels: TenantFormLabels;
}) {
  const router = useRouter();
  const [v, setV] = useState<Values>(() => fromConfig(initial));
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const working = status.kind === 'working';
  const set = <K extends keyof Values>(key: K, value: Values[K]) => {
    setV((prev) => ({ ...prev, [key]: value }));
    setStatus({ kind: 'idle' });
  };

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setStatus({ kind: 'working' });
    const config = toConfig(initial, v);
    const path =
      mode === 'create'
        ? '/api/platform/tenants'
        : `/api/platform/tenants/${encodeURIComponent(initial.slug)}`;
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ config }),
    });
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
      issues?: string[];
    };
    if (!response.ok) {
      const message =
        body.error === 'exists'
          ? labels.exists
          : body.error === 'invalid'
            ? labels.invalid.replace('{issues}', (body.issues ?? []).join('; '))
            : labels.failed;
      setStatus({ kind: 'error', message });
      return;
    }
    setStatus({ kind: 'done', message: labels.done });
    if (mode === 'create') router.push('/admin');
    else router.refresh();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <section className="ios-card grid grid-cols-1 gap-4 rounded-2xl p-4 sm:grid-cols-2">
        <Field label={labels.slug}>
          <input
            className={field}
            value={v.slug}
            onChange={(e) => set('slug', e.target.value)}
            disabled={mode === 'edit'}
            required
            // Browsers compile `pattern` with the v flag, where a bare hyphen inside
            // a class is a syntax error that silently aborts the submit. Escaped.
            pattern="[a-z0-9]([a-z0-9\-]*[a-z0-9])?"
            autoComplete="off"
          />
        </Field>
        <Field label={labels.displayName}>
          <input
            className={field}
            value={v.displayName}
            onChange={(e) => set('displayName', e.target.value)}
            required
            autoComplete="off"
          />
        </Field>
        <Field label={labels.timezone}>
          <input
            className={field}
            value={v.timezone}
            onChange={(e) => set('timezone', e.target.value)}
            required
            autoComplete="off"
          />
        </Field>
        <Field label={labels.locale}>
          <input
            className={field}
            value={v.locale}
            onChange={(e) => set('locale', e.target.value)}
            required
            autoComplete="off"
          />
        </Field>
        <Field label={labels.timeFormat}>
          <select
            className={field}
            value={v.timeFormat}
            onChange={(e) => set('timeFormat', e.target.value as Values['timeFormat'])}
          >
            <option value="12h">{labels.timeFormat12h}</option>
            <option value="24h">{labels.timeFormat24h}</option>
          </select>
        </Field>
        <Field label={labels.joinMode}>
          <select
            className={field}
            value={v.joinMode}
            onChange={(e) => set('joinMode', e.target.value as Values['joinMode'])}
          >
            <option value="domain">{labels.joinModeDomain}</option>
            <option value="invite">{labels.joinModeInvite}</option>
          </select>
        </Field>
        <Field label={labels.primaryColor}>
          <input
            type="color"
            className="ios-field h-11 w-full rounded-xl px-2"
            value={v.primaryColor}
            onChange={(e) => set('primaryColor', e.target.value)}
          />
        </Field>
        <Field label={labels.logoPath}>
          <input
            className={field}
            value={v.logoPath}
            onChange={(e) => set('logoPath', e.target.value)}
            required
            autoComplete="off"
          />
        </Field>
      </section>

      <section className="ios-card grid grid-cols-1 gap-4 rounded-2xl p-4">
        <Field label={labels.allowedEmailDomains} hint={labels.listHint}>
          <input
            className={field}
            value={v.allowedEmailDomains}
            onChange={(e) => set('allowedEmailDomains', e.target.value)}
            autoComplete="off"
          />
        </Field>
        <Field label={labels.adminEmails} hint={labels.adminEmailsHint}>
          <textarea
            className={area}
            value={v.adminEmails}
            onChange={(e) => set('adminEmails', e.target.value)}
            autoComplete="off"
          />
        </Field>
        <Field label={labels.enabledModules} hint={labels.listHint}>
          <input
            className={field}
            value={v.enabledModules}
            onChange={(e) => set('enabledModules', e.target.value)}
            autoComplete="off"
          />
        </Field>
        <Field label={labels.aliases} hint={labels.listHint}>
          <input
            className={field}
            value={v.aliases}
            onChange={(e) => set('aliases', e.target.value)}
            autoComplete="off"
          />
        </Field>
      </section>

      <section className="ios-card grid grid-cols-1 gap-4 rounded-2xl p-4">
        <Field label={labels.seoTitleTemplate}>
          <input
            className={field}
            value={v.seoTitleTemplate}
            onChange={(e) => set('seoTitleTemplate', e.target.value)}
            required
            autoComplete="off"
          />
        </Field>
        <Field label={labels.seoDescription}>
          <textarea
            className={area}
            value={v.seoDescription}
            onChange={(e) => set('seoDescription', e.target.value)}
            required
          />
        </Field>
        <Field label={labels.seoKeywords} hint={labels.listHint}>
          <input
            className={field}
            value={v.seoKeywords}
            onChange={(e) => set('seoKeywords', e.target.value)}
            autoComplete="off"
          />
        </Field>
        <Field label={labels.seoAliases} hint={labels.listHint}>
          <input
            className={field}
            value={v.seoAliases}
            onChange={(e) => set('seoAliases', e.target.value)}
            autoComplete="off"
          />
        </Field>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={working}
          aria-busy={working || undefined}
          className={buttonVariants()}
        >
          {working ? labels.working : labels.submit}
        </button>
        {status.kind === 'done' || status.kind === 'error' ? (
          <p
            role="status"
            className={
              status.kind === 'error' ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'
            }
          >
            {status.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}
