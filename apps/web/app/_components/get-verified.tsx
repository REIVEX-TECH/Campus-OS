'use client';

import { buttonVariants } from '@campusos/ui';
import { useVerifyGate } from './verify-gate';

/**
 * The "Get verified" button. Opens the tenant's shared verification modal (hosted
 * by the layout's VerifyGateProvider), so every place that offers verification
 * uses one modal and one code path. Renders nothing outside a provider.
 */
export function GetVerified({ variant = 'default' }: { variant?: 'default' | 'outline' }) {
  const gate = useVerifyGate();
  if (!gate) return null;
  return (
    <button
      type="button"
      onClick={gate.openVerify}
      className={buttonVariants({ size: 'sm', variant })}
    >
      {gate.buttonLabel}
    </button>
  );
}

/**
 * The inline affordance for a wall an unverified member hits (a comment box, a
 * blocked action). Renders nothing for a verified person or a stranger; for an
 * unverified member it shows the optional note and the Get verified button. Safe
 * to place from a server component.
 */
export function VerifyGateInline({ note }: { note?: string }) {
  const gate = useVerifyGate();
  if (!gate?.needsVerify) return null;
  return (
    <div className="flex flex-col items-start gap-1.5">
      {note ? <p className="text-sm text-muted-foreground">{note}</p> : null}
      <GetVerified variant="outline" />
    </div>
  );
}
