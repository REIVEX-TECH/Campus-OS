'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { buttonVariants } from '@campusos/ui';
import { IdentityAvatar } from '../identity-avatar';

/**
 * The members of a tenant, with what a member manager may do to each: the
 * roles they hold, and whether the membership is suspended.
 *
 * Every change is one POST the server treats as idempotent and re-checks inside
 * its own transaction; the list refreshes from the server afterwards rather
 * than being edited here. Nothing on this list is an email.
 */

export type MemberRole = { key: string; name: string };

export type MemberItem = {
  userId: string;
  handle: string | null;
  avatarSeed: string;
  roles: MemberRole[];
  standing: 'active' | 'restricted' | 'suspended';
  /** Why and until when, already worded. Null when in good standing. */
  standingLine: string | null;
  verified: boolean;
  /** Already formatted for the locale. */
  since: string;
  /** Already translated: how recently they were seen. */
  activity: string;
};

export type MembersLabels = {
  noProfile: string;
  you: string;
  verified: string;
  unverified: string;
  restricted: string;
  suspended: string;
  restrict: string;
  restrictPrompt: string;
  roles: string;
  noRoles: string;
  addRole: string;
  /** "{role}" is replaced with the role's name. */
  removeRole: string;
  suspend: string;
  suspendPrompt: string;
  reinstate: string;
  working: string;
  saved: string;
  lastAdmin: string;
  self: string;
  failed: string;
  showIdentity: string;
  hideIdentity: string;
  revealing: string;
  identityName: string;
  identityRoll: string;
  identityEmail: string;
  identityNone: string;
};

type Outcome = { userId: string; message: string; error: boolean };
type RevealedIdentity = { fullName: string | null; rollNumber: string | null; email: string };

export function MembersList({
  tenant,
  selfUserId,
  canManageRoles,
  canRestrict,
  canViewIdentity,
  roles,
  items,
  labels,
}: {
  tenant: string;
  selfUserId: string;
  canManageRoles: boolean;
  canRestrict: boolean;
  canViewIdentity: boolean;
  roles: MemberRole[];
  items: MemberItem[];
  labels: MembersLabels;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [revealed, setRevealed] = useState<Record<string, RevealedIdentity>>({});
  const [revealBusy, setRevealBusy] = useState<string | null>(null);

  async function reveal(userId: string): Promise<void> {
    setRevealBusy(userId);
    const response = await fetch('/api/admin/members/identity', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenant, userId }),
    });
    const result = (await response.json().catch(() => ({}))) as {
      fullName?: string | null;
      rollNumber?: string | null;
      email?: string;
    };
    setRevealBusy(null);
    if (!response.ok || !result.email) {
      setOutcome({ userId, message: labels.failed, error: true });
      return;
    }
    setRevealed((r) => ({
      ...r,
      [userId]: {
        fullName: result.fullName ?? null,
        rollNumber: result.rollNumber ?? null,
        email: result.email!,
      },
    }));
  }

  function hide(userId: string): void {
    setRevealed((r) => {
      const next = { ...r };
      delete next[userId];
      return next;
    });
  }

  async function post(userId: string, path: string, body: Record<string, unknown>): Promise<void> {
    setBusy(userId);
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenant, ...body }),
    });
    const result = (await response.json().catch(() => ({}))) as { error?: string };
    setBusy(null);
    if (!response.ok) {
      const message =
        result.error === 'last_admin'
          ? labels.lastAdmin
          : result.error === 'self'
            ? labels.self
            : labels.failed;
      setOutcome({ userId, message, error: true });
      return;
    }
    setOutcome({ userId, message: labels.saved, error: false });
    router.refresh();
  }

  return (
    <ul className="flex flex-col gap-2">
      {items.map((m) => {
        const self = m.userId === selfUserId;
        const held = new Set(m.roles.map((r) => r.key));
        const available = roles.filter((r) => !held.has(r.key));
        const name = m.handle ?? labels.noProfile;
        const isBusy = busy === m.userId;
        const status =
          m.standing === 'suspended'
            ? labels.suspended
            : m.standing === 'restricted'
              ? labels.restricted
              : m.verified
                ? labels.verified
                : labels.unverified;
        return (
          <li key={m.userId} className="ios-card flex flex-col gap-3 rounded-2xl p-4">
            <div className="flex items-center gap-3">
              <IdentityAvatar seed={m.avatarSeed} label={name} size={40} />
              <div className="flex min-w-0 flex-1 flex-col">
                <p className="truncate text-sm font-semibold">
                  {name}
                  {self ? (
                    <span className="ml-2 text-xs font-medium text-muted-foreground">
                      {labels.you}
                    </span>
                  ) : null}
                </p>
                <p className="text-xs text-muted-foreground">
                  {m.since}. {m.activity}
                </p>
              </div>
              <span
                className={
                  m.standing !== 'active'
                    ? 'shrink-0 rounded-full bg-destructive/10 px-2.5 py-0.5 text-xs font-medium text-destructive'
                    : 'shrink-0 rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground'
                }
              >
                {status}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-1.5" aria-label={labels.roles}>
              {m.roles.length === 0 ? (
                <span className="text-xs text-muted-foreground">{labels.noRoles}</span>
              ) : null}
              {m.roles.map((r) => (
                <span
                  key={r.key}
                  className="inline-flex items-center gap-0.5 rounded-full bg-muted py-0.5 pl-2.5 pr-1 text-xs font-medium"
                >
                  {r.name}
                  {canManageRoles ? (
                    <button
                      type="button"
                      onClick={() =>
                        post(m.userId, '/api/admin/roles', {
                          userId: m.userId,
                          roleKey: r.key,
                          action: 'revoke',
                        })
                      }
                      disabled={busy !== null}
                      aria-label={labels.removeRole.replace('{role}', r.name)}
                      className="ios-pressable inline-flex size-6 items-center justify-center rounded-full text-muted-foreground hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <svg
                        aria-hidden="true"
                        viewBox="0 0 16 16"
                        className="size-3"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                      >
                        <path d="M4 4l8 8M12 4l-8 8" />
                      </svg>
                    </button>
                  ) : (
                    <span className="w-1.5" aria-hidden="true" />
                  )}
                </span>
              ))}
              {canManageRoles && available.length > 0 ? (
                <select
                  aria-label={labels.addRole}
                  value=""
                  disabled={busy !== null}
                  onChange={(e) => {
                    const roleKey = e.target.value;
                    if (roleKey) {
                      void post(m.userId, '/api/admin/roles', {
                        userId: m.userId,
                        roleKey,
                        action: 'grant',
                      });
                    }
                  }}
                  className="ios-field h-7 rounded-full pl-2.5 pr-7 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="">{labels.addRole}</option>
                  {available.map((r) => (
                    <option key={r.key} value={r.key}>
                      {r.name}
                    </option>
                  ))}
                </select>
              ) : null}
            </div>

            {m.standingLine ? (
              <p className="text-xs text-muted-foreground">{m.standingLine}</p>
            ) : null}

            {canViewIdentity ? (
              revealed[m.userId] ? (
                <div className="flex flex-col gap-1 rounded-xl bg-muted/50 p-3 text-sm">
                  <p>
                    <span className="text-muted-foreground">{labels.identityEmail}: </span>
                    {revealed[m.userId]!.email}
                  </p>
                  {revealed[m.userId]!.fullName ? (
                    <p>
                      <span className="text-muted-foreground">{labels.identityName}: </span>
                      {revealed[m.userId]!.fullName}
                    </p>
                  ) : null}
                  {revealed[m.userId]!.rollNumber ? (
                    <p>
                      <span className="text-muted-foreground">{labels.identityRoll}: </span>
                      {revealed[m.userId]!.rollNumber}
                    </p>
                  ) : null}
                  {!revealed[m.userId]!.fullName && !revealed[m.userId]!.rollNumber ? (
                    <p className="text-xs text-muted-foreground">{labels.identityNone}</p>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => hide(m.userId)}
                    className="self-start text-xs font-medium text-primary hover:underline"
                  >
                    {labels.hideIdentity}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => reveal(m.userId)}
                  disabled={revealBusy !== null}
                  aria-busy={revealBusy === m.userId || undefined}
                  className="self-start text-xs font-medium text-primary hover:underline disabled:opacity-50"
                >
                  {revealBusy === m.userId ? labels.revealing : labels.showIdentity}
                </button>
              )
            ) : null}

            {self && outcome?.userId !== m.userId ? null : (
              <div className="flex flex-wrap items-center gap-2">
                {self || !canRestrict ? null : m.standing === 'active' ? (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        const reason = window.prompt(labels.restrictPrompt)?.trim() ?? '';
                        if (reason.length < 3) return;
                        post(m.userId, '/api/admin/members/status', {
                          userId: m.userId,
                          status: 'restricted',
                          reason,
                        });
                      }}
                      disabled={busy !== null}
                      aria-busy={isBusy || undefined}
                      className={buttonVariants({ size: 'sm', variant: 'outline' })}
                    >
                      {isBusy ? labels.working : labels.restrict}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const reason = window.prompt(labels.suspendPrompt)?.trim() ?? '';
                        if (reason.length < 3) return;
                        post(m.userId, '/api/admin/members/status', {
                          userId: m.userId,
                          status: 'suspended',
                          reason,
                        });
                      }}
                      disabled={busy !== null}
                      className={buttonVariants({ size: 'sm', variant: 'outline' })}
                    >
                      {labels.suspend}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() =>
                      post(m.userId, '/api/admin/members/status', {
                        userId: m.userId,
                        status: 'active',
                      })
                    }
                    disabled={busy !== null}
                    aria-busy={isBusy || undefined}
                    className={buttonVariants({ size: 'sm', variant: 'outline' })}
                  >
                    {isBusy ? labels.working : labels.reinstate}
                  </button>
                )}
                {outcome?.userId === m.userId ? (
                  <p
                    role="status"
                    className={
                      outcome.error ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'
                    }
                  >
                    {outcome.message}
                  </p>
                ) : null}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
