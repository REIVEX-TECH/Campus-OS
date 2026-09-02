import type { ReactNode } from 'react';
import { IdentityAvatar } from '../identity-avatar';
import type { AvatarKind } from '@/lib/avatar';

/**
 * The head of a teacher or room profile: the generated avatar beside the name,
 * a quiet line of context, and any actions. Shared so both profiles read as one
 * family. The avatar is decorative here because the name sits next to it as
 * real text, so screen readers are not told the initials twice.
 */
export function ProfileHeader({
  seed,
  title,
  kind = 'person',
  context,
  badge,
  actions,
}: {
  seed: string;
  title: string;
  kind?: AvatarKind;
  context?: ReactNode;
  badge?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4 px-1">
      <div className="flex min-w-0 items-center gap-3 sm:gap-4">
        <span aria-hidden="true">
          <IdentityAvatar
            seed={seed}
            label={title}
            kind={kind}
            size={56}
            className="sm:h-16 sm:w-16"
          />
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          {context ? <div className="text-sm text-muted-foreground">{context}</div> : null}
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-bold tracking-tight">
            <span className="min-w-0 break-words">{title}</span>
            {badge}
          </h1>
        </div>
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}
