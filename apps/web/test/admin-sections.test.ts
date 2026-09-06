import { describe, expect, it } from 'vitest';
import { PermissionSet } from '@campusos/core';
import { ADMIN_SECTIONS, firstAdminSection, visibleAdminSections } from '@/lib/admin-sections';

describe('admin sections', () => {
  it('shows only the sections a permission opens, in display order', () => {
    const p = new PermissionSet(['view-analytics', 'manage-members']);
    // manage-members opens the members list, the join-policy editor, and the
    // (read-only) roles catalogue. Assigning roles is platform-only now (identity
    // 0032), so the roles nav is gated on manage-members, not manage-roles.
    expect(visibleAdminSections(p).map((s) => s.key)).toEqual([
      'members',
      'join-policy',
      'roles',
      'analytics',
    ]);
  });

  it('shows a resident admin the roles catalogue but never keys it on manage-roles', () => {
    // A resident admin holds manage-members but not manage-roles, and still sees
    // the roles section (read-only); the grant control on the page is what checks
    // manage-roles, so it is absent for them.
    const resident = new PermissionSet(['manage-members']);
    expect(visibleAdminSections(resident).map((s) => s.key)).toContain('roles');
    expect(resident.has('manage-roles')).toBe(false);
    const roles = ADMIN_SECTIONS.find((s) => s.key === 'roles');
    expect(roles?.permission).toBe('manage-members');
  });

  it('sends /admin to the first section the person may open', () => {
    expect(firstAdminSection(new PermissionSet(['manage-rooms']))?.path).toBe('/admin/rooms');
    // An administrator lands on the queue, as before.
    const all = new PermissionSet(ADMIN_SECTIONS.map((s) => s.permission));
    expect(firstAdminSection(all)?.key).toBe('verification');
  });

  it('has nowhere to send someone with no permission that opens a section', () => {
    expect(firstAdminSection(new PermissionSet(['post']))).toBeNull();
    expect(firstAdminSection(new PermissionSet([]))).toBeNull();
  });

  it('keeps every section behind a distinct path', () => {
    expect(new Set(ADMIN_SECTIONS.map((s) => s.path)).size).toBe(ADMIN_SECTIONS.length);
  });
});
