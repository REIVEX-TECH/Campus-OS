'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { buttonVariants } from '@campusos/ui';

/**
 * The role definitions, for a platform administrator.
 *
 * Which roles exist and what each one carries, for every university at once. A
 * system definition is shown and never edited: `tenant_admin` holding
 * everything is what keeps a university able to administer itself, and deleting
 * it would lock every one of them out together. Saving a change rewrites every
 * tenant's copy in the same transaction.
 */

export type TemplateItem = {
  key: string;
  name: string;
  isSystem: boolean;
  permissions: string[];
};

export type TemplateLabels = {
  builtIn: string;
  builtInNote: string;
  permissions: string;
  none: string;
  save: string;
  saved: string;
  newTemplate: string;
  name: string;
  create: string;
  /** "{name}" is replaced with the new definition's name. */
  created: string;
  remove: string;
  removeConfirm: string;
  removed: string;
  exists: string;
  badName: string;
  working: string;
  failed: string;
};

type Shared = {
  permissions: string[];
  permissionLabels: Record<string, string>;
  labels: TemplateLabels;
};

type Status = { kind: 'idle' | 'working' } | { kind: 'done' | 'error'; message: string };

async function send(body: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
  const response = await fetch('/api/platform/roles', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const result = (await response.json().catch(() => ({}))) as { error?: string };
  return { ok: response.ok, ...result };
}

function failureMessage(error: string | undefined, labels: TemplateLabels): string {
  if (error === 'exists') return labels.exists;
  if (error === 'bad_name') return labels.badName;
  return labels.failed;
}

function toggled(prev: ReadonlySet<string>, permission: string, on: boolean): Set<string> {
  const next = new Set(prev);
  if (on) next.add(permission);
  else next.delete(permission);
  return next;
}

function PermissionGrid({
  idPrefix,
  permissions,
  permissionLabels,
  chosen,
  onToggle,
  disabled,
}: {
  idPrefix: string;
  chosen: ReadonlySet<string>;
  onToggle: (permission: string, on: boolean) => void;
  disabled: boolean;
} & Omit<Shared, 'labels'>) {
  return (
    <div className="grid grid-cols-1 gap-0.5 sm:grid-cols-2">
      {permissions.map((p) => (
        <label
          key={p}
          htmlFor={`${idPrefix}-${p}`}
          className="flex min-h-10 cursor-pointer items-center gap-2.5 rounded-xl px-2 text-sm hover:bg-muted/60"
        >
          <input
            id={`${idPrefix}-${p}`}
            type="checkbox"
            checked={chosen.has(p)}
            disabled={disabled}
            onChange={(e) => onToggle(p, e.target.checked)}
            className="size-4 shrink-0 accent-primary"
          />
          {permissionLabels[p] ?? p}
        </label>
      ))}
    </div>
  );
}

function StatusLine({ status }: { status: Status }) {
  if (status.kind !== 'done' && status.kind !== 'error') return null;
  return (
    <p
      role="status"
      className={
        status.kind === 'error' ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'
      }
    >
      {status.message}
    </p>
  );
}

function TemplateCard({
  template,
  permissions,
  permissionLabels,
  labels,
}: { template: TemplateItem } & Shared) {
  const router = useRouter();
  const [chosen, setChosen] = useState<ReadonlySet<string>>(() => new Set(template.permissions));
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const saved = new Set(template.permissions);
  const changed = chosen.size !== saved.size || [...chosen].some((p) => !saved.has(p));
  const working = status.kind === 'working';

  async function act(body: Record<string, unknown>, done: string): Promise<void> {
    setStatus({ kind: 'working' });
    const result = await send(body);
    if (!result.ok) {
      setStatus({ kind: 'error', message: failureMessage(result.error, labels) });
      return;
    }
    setStatus({ kind: 'done', message: done });
    router.refresh();
  }

  return (
    <article className="ios-card flex flex-col gap-3 rounded-2xl p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-base font-semibold">{template.name}</h3>
        {template.isSystem ? (
          <span className="shrink-0 rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
            {labels.builtIn}
          </span>
        ) : (
          <code className="text-xs text-muted-foreground">{template.key}</code>
        )}
      </div>
      <PermissionGrid
        idPrefix={`template-${template.key}`}
        permissions={permissions}
        permissionLabels={permissionLabels}
        chosen={chosen}
        disabled={working}
        onToggle={(p, on) => {
          setChosen((prev) => toggled(prev, p, on));
          setStatus({ kind: 'idle' });
        }}
      />
      {template.isSystem ? (
        <p className="text-xs text-muted-foreground">{labels.builtInNote}</p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() =>
            act(
              { action: 'permissions', key: template.key, permissions: [...chosen] },
              labels.saved,
            )
          }
          disabled={!changed || working}
          aria-busy={working || undefined}
          className={buttonVariants({ size: 'sm' })}
        >
          {working ? labels.working : labels.save}
        </button>
        {template.isSystem ? null : (
          <button
            type="button"
            onClick={() => {
              if (!window.confirm(labels.removeConfirm)) return;
              void act({ action: 'delete', key: template.key }, labels.removed);
            }}
            disabled={working}
            className={buttonVariants({ size: 'sm', variant: 'outline' })}
          >
            {labels.remove}
          </button>
        )}
        <StatusLine status={status} />
      </div>
    </article>
  );
}

function NewTemplate({ permissions, permissionLabels, labels }: Shared) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [chosen, setChosen] = useState<ReadonlySet<string>>(() => new Set());
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const working = status.kind === 'working';

  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        setStatus({ kind: 'working' });
        const result = await send({
          action: 'create',
          name: name.trim(),
          permissions: [...chosen],
        });
        if (!result.ok) {
          setStatus({ kind: 'error', message: failureMessage(result.error, labels) });
          return;
        }
        setStatus({ kind: 'done', message: labels.created.replace('{name}', name.trim()) });
        setName('');
        setChosen(new Set());
        router.refresh();
      }}
      className="ios-card flex flex-col gap-3 rounded-2xl p-4"
    >
      <h3 className="text-base font-semibold">{labels.newTemplate}</h3>
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">{labels.name}</span>
        <input
          name="name"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setStatus({ kind: 'idle' });
          }}
          autoComplete="off"
          required
          maxLength={60}
          className="ios-field h-11 w-full max-w-sm rounded-xl px-3.5 text-[15px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </label>
      <PermissionGrid
        idPrefix="new-template"
        permissions={permissions}
        permissionLabels={permissionLabels}
        chosen={chosen}
        disabled={working}
        onToggle={(p, on) => setChosen((prev) => toggled(prev, p, on))}
      />
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={working}
          aria-busy={working || undefined}
          className={buttonVariants({ size: 'sm', variant: 'outline' })}
        >
          {working ? labels.working : labels.create}
        </button>
        <StatusLine status={status} />
      </div>
    </form>
  );
}

export function RoleDefinitions({
  templates,
  permissions,
  permissionLabels,
  labels,
}: { templates: TemplateItem[] } & Shared) {
  const shared = { permissions, permissionLabels, labels };
  return (
    <div className="flex flex-col gap-3">
      {templates.map((template) => (
        <TemplateCard key={template.key} template={template} {...shared} />
      ))}
      <NewTemplate {...shared} />
    </div>
  );
}
