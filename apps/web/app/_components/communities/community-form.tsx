'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { buttonVariants } from '@campusos/ui';

/**
 * Create a community, or change one. The same fields either way; the slug is
 * derived from the name on creation and never changes afterwards.
 */

export type CommunityFormValues = {
  name: string;
  description: string;
  allowAnonymous: boolean;
  allowedKinds: ('text' | 'link' | 'poll')[];
  visibility: 'public' | 'restricted';
  modLogPublic: boolean;
  minKarmaToPost: number;
  minKarmaToComment: number;
  minKarmaToJoin: number;
  minAccountAgeDays: number;
  requireVerified: boolean;
};

export type CommunityFormLabels = {
  name: string;
  description: string;
  allowAnonymous: string;
  allowAnonymousHint: string;
  kinds: string;
  kindText: string;
  kindLink: string;
  kindPoll: string;
  visibility: string;
  visibilityPublic: string;
  visibilityRestricted: string;
  modLogPublic: string;
  gates: string;
  gatesHint: string;
  minKarmaToPost: string;
  minKarmaToComment: string;
  minKarmaToJoin: string;
  minAccountAgeDays: string;
  requireVerified: string;
  submit: string;
  working: string;
  done: string;
  errors: Record<string, string>;
};

const field =
  'ios-field h-11 w-full rounded-xl px-3.5 text-[15px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
const area =
  'ios-field min-h-24 w-full rounded-xl px-3.5 py-2.5 text-[15px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

export function CommunityForm({
  tenant,
  base,
  mode,
  communityId,
  initial,
  anonymousAllowedByTenant,
  labels,
}: {
  tenant: string;
  base: string;
  mode: 'create' | 'edit';
  communityId?: string;
  initial: CommunityFormValues;
  anonymousAllowedByTenant: boolean;
  labels: CommunityFormLabels;
}) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [status, setStatus] = useState<{
    kind: 'idle' | 'working' | 'done' | 'error';
    message?: string;
  }>({
    kind: 'idle',
  });
  const working = status.kind === 'working';
  const set = <K extends keyof CommunityFormValues>(key: K, value: CommunityFormValues[K]) => {
    setV((prev) => ({ ...prev, [key]: value }));
    setStatus({ kind: 'idle' });
  };
  const toggleKind = (kind: 'text' | 'link' | 'poll', on: boolean) =>
    set(
      'allowedKinds',
      on
        ? Array.from(new Set([...v.allowedKinds, kind]))
        : v.allowedKinds.filter((k) => k !== kind),
    );

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setStatus({ kind: 'working' });
    const path =
      mode === 'create' ? '/api/communities' : `/api/communities/${communityId}/settings`;
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenant, ...v }),
    });
    const body = (await response.json().catch(() => ({}))) as { error?: string; slug?: string };
    if (!response.ok) {
      setStatus({
        kind: 'error',
        message: labels.errors[body.error ?? ''] ?? labels.errors.failed ?? '',
      });
      return;
    }
    setStatus({ kind: 'done', message: labels.done });
    // Refresh first so the shell's "Your communities" already lists it when the
    // new page appears; a soft navigation alone would keep the layout as it was.
    router.refresh();
    if (mode === 'create' && body.slug) router.push(`${base}/c/${body.slug}`);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">{labels.name}</span>
        <input
          className={field}
          value={v.name}
          onChange={(e) => set('name', e.target.value)}
          required
          minLength={3}
          maxLength={60}
          autoComplete="off"
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">{labels.description}</span>
        <textarea
          className={area}
          value={v.description}
          onChange={(e) => set('description', e.target.value)}
          maxLength={500}
        />
      </label>

      <fieldset className="flex flex-col gap-1.5">
        <legend className="text-sm font-medium">{labels.kinds}</legend>
        <div className="flex flex-wrap gap-4">
          {(['text', 'link', 'poll'] as const).map((kind) => (
            <label key={kind} className="flex min-h-10 items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={v.allowedKinds.includes(kind)}
                onChange={(e) => toggleKind(kind, e.target.checked)}
              />
              {kind === 'text'
                ? labels.kindText
                : kind === 'link'
                  ? labels.kindLink
                  : labels.kindPoll}
            </label>
          ))}
        </div>
      </fieldset>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">{labels.visibility}</span>
        <select
          className={field}
          value={v.visibility}
          onChange={(e) => set('visibility', e.target.value as CommunityFormValues['visibility'])}
        >
          <option value="public">{labels.visibilityPublic}</option>
          <option value="restricted">{labels.visibilityRestricted}</option>
        </select>
      </label>

      {anonymousAllowedByTenant ? (
        <label className="flex flex-col gap-1">
          <span className="flex min-h-10 items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={v.allowAnonymous}
              onChange={(e) => set('allowAnonymous', e.target.checked)}
            />
            {labels.allowAnonymous}
          </span>
          <span className="pl-6 text-xs text-muted-foreground">{labels.allowAnonymousHint}</span>
        </label>
      ) : null}

      {mode === 'edit' ? (
        <label className="flex min-h-10 items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={v.modLogPublic}
            onChange={(e) => set('modLogPublic', e.target.checked)}
          />
          {labels.modLogPublic}
        </label>
      ) : null}

      {mode === 'edit' ? (
        <fieldset className="flex flex-col gap-3 rounded-2xl border border-border p-4">
          <legend className="px-1 text-sm font-medium">{labels.gates}</legend>
          <p className="text-xs text-muted-foreground">{labels.gatesHint}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {(
              [
                ['minKarmaToPost', labels.minKarmaToPost, 10_000],
                ['minKarmaToComment', labels.minKarmaToComment, 10_000],
                ['minKarmaToJoin', labels.minKarmaToJoin, 10_000],
                ['minAccountAgeDays', labels.minAccountAgeDays, 365],
              ] as const
            ).map(([key, label, max]) => (
              <label key={key} className="flex flex-col gap-1.5 text-sm font-medium">
                {label}
                <input
                  type="number"
                  min={0}
                  max={max}
                  value={v[key]}
                  onChange={(e) =>
                    set(key, Math.max(0, Math.min(max, Number(e.target.value) || 0)))
                  }
                  className="ios-field h-10 w-full rounded-xl px-3.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </label>
            ))}
          </div>
          <label className="flex min-h-10 items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={v.requireVerified}
              onChange={(e) => set('requireVerified', e.target.checked)}
            />
            {labels.requireVerified}
          </label>
        </fieldset>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={working || v.allowedKinds.length === 0}
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
