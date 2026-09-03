'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { buttonVariants } from '@campusos/ui';

/**
 * A tenant's roles and what each may do.
 *
 * The three built in roles are shown and never edited: `tenant_admin` holding
 * everything is what keeps a tenant able to administer itself. A role of the
 * tenant's own is a name and a set of permissions, saved as a whole; the
 * server re-checks `manage-roles` inside the transaction each time.
 */

export type RoleItem = { key: string; name: string; isSystem: boolean; permissions: string[] };

export type RoleLabels = {
  builtIn: string;
  builtInNote: string;
  permissions: string;
  none: string;
  save: string;
  saved: string;
  newRole: string;
  name: string;
  create: string;
  /** "{name}" is replaced with the new role's name. */
  created: string;
  exists: string;
  badName: string;
  working: string;
  failed: string;
};

type Props = {
  tenant: string;
  roles: RoleItem[];
  permissions: string[];
  permissionLabels: Record<string, string>;
  labels: RoleLabels;
};

type Status = { kind: 'idle' | 'working' } | { kind: 'done' | 'error'; message: string };

async function define(
  body: Record<string, unknown>,
): Promise<{ ok: boolean; error?: string; role?: { name: string } }> {
  const response = await fetch('/api/admin/roles/define', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const result = (await response.json().catch(() => ({}))) as {
    error?: string;
    role?: { name: string };
  };
  return { ok: response.ok, ...result };
}

function failureMessage(error: string | undefined, labels: RoleLabels): string {
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
  permissions: string[];
  permissionLabels: Record<string, string>;
  chosen: ReadonlySet<string>;
  onToggle: (permission: string, on: boolean) => void;
  disabled: boolean;
}) {
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

function RoleCard({
  tenant,
  role,
  permissions,
  permissionLabels,
  labels,
}: { role: RoleItem } & Omit<Props, 'roles'>) {
  const router = useRouter();
  const [chosen, setChosen] = useState<ReadonlySet<string>>(() => new Set(role.permissions));
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const saved = new Set(role.permissions);
  const changed = chosen.size !== saved.size || [...chosen].some((p) => !saved.has(p));
  const working = status.kind === 'working';

  async function save(): Promise<void> {
    setStatus({ kind: 'working' });
    const result = await define({ tenant, roleKey: role.key, permissions: [...chosen] });
    if (!result.ok) {
      setStatus({ kind: 'error', message: failureMessage(result.error, labels) });
      return;
    }
    setStatus({ kind: 'done', message: labels.saved });
    router.refresh();
  }

  return (
    <article className="ios-card flex flex-col gap-3 rounded-2xl p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-base font-semibold">{role.name}</h3>
        {role.isSystem ? (
          <span className="shrink-0 rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
            {labels.builtIn}
          </span>
        ) : (
          <code className="text-xs text-muted-foreground">{role.key}</code>
        )}
      </div>
      {role.isSystem ? (
        <>
          <ul className="flex flex-wrap gap-1.5" aria-label={labels.permissions}>
            {role.permissions.length === 0 ? (
              <li className="text-xs text-muted-foreground">{labels.none}</li>
            ) : null}
            {role.permissions.map((p) => (
              <li key={p} className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium">
                {permissionLabels[p] ?? p}
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">{labels.builtInNote}</p>
        </>
      ) : (
        <>
          <PermissionGrid
            idPrefix={`role-${role.key}`}
            permissions={permissions}
            permissionLabels={permissionLabels}
            chosen={chosen}
            disabled={working}
            onToggle={(p, on) => {
              setChosen((prev) => toggled(prev, p, on));
              setStatus({ kind: 'idle' });
            }}
          />
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={save}
              disabled={!changed || working}
              aria-busy={working || undefined}
              className={buttonVariants({ size: 'sm' })}
            >
              {working ? labels.working : labels.save}
            </button>
            <StatusLine status={status} />
          </div>
        </>
      )}
    </article>
  );
}

function NewRole({ tenant, permissions, permissionLabels, labels }: Omit<Props, 'roles'>) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [chosen, setChosen] = useState<ReadonlySet<string>>(() => new Set());
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const working = status.kind === 'working';

  async function create(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setStatus({ kind: 'working' });
    const result = await define({ tenant, name: name.trim(), permissions: [...chosen] });
    if (!result.ok) {
      setStatus({ kind: 'error', message: failureMessage(result.error, labels) });
      return;
    }
    setStatus({
      kind: 'done',
      message: labels.created.replace('{name}', result.role?.name ?? name.trim()),
    });
    setName('');
    setChosen(new Set());
    router.refresh();
  }

  return (
    <form onSubmit={create} className="ios-card flex flex-col gap-3 rounded-2xl p-4">
      <h3 className="text-base font-semibold">{labels.newRole}</h3>
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
        idPrefix="new-role"
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

export function RoleEditor({ tenant, roles, permissions, permissionLabels, labels }: Props) {
  const shared = { tenant, permissions, permissionLabels, labels };
  return (
    <div className="flex flex-col gap-3">
      {roles.map((role) => (
        <RoleCard key={role.key} role={role} {...shared} />
      ))}
      <NewRole {...shared} />
    </div>
  );
}
