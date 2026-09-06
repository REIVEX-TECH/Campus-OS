import { describe, expect, it } from 'vitest';
import { PermissionSet } from '@campusos/core';
import { ADMIN_SECTIONS, firstAdminSection, visibleAdminSections } from '@/lib/admin-sections';

describe('admin sections', () => {
  it('shows only the sections a permission opens, in display order', () => {
    const p = new PermissionSet(['view-analytics', 'manage-members']);
    // manage-members opens both the members list and the join-policy editor.
    expect(visibleAdminSections(p).map((s) => s.key)).toEqual([
      'members',
      'join-policy',
      'analytics',
    ]);
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
