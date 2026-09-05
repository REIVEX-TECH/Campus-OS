'use client';

import { useState } from 'react';
import { buttonVariants } from '@campusos/ui';
import { GrantReasonModal, type GrantModalLabels } from './grant-reason-modal';

/**
 * The "Enter" control beside a tenant on the platform /admin list. Opens the
 * reason modal, which opens a grant and navigates into that tenant's admin.
 */
export function EnterTenantButton({
  tenantSlug,
  tenantName,
  enterLabel,
  labels,
}: {
  tenantSlug: string;
  tenantName: string;
  enterLabel: string;
  labels: GrantModalLabels;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={buttonVariants({ size: 'sm', variant: 'outline' })}
      >
        {enterLabel}
      </button>
      <GrantReasonModal
        open={open}
        onClose={() => setOpen(false)}
        tenantSlug={tenantSlug}
        tenantName={tenantName}
        labels={labels}
      />
    </>
  );
}
