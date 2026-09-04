import { describe, expect, it } from 'vitest';
import {
  NO_PERMISSIONS,
  PERMISSIONS,
  PermissionSet,
  SYSTEM_ROLES,
  SYSTEM_ROLE_KEYS,
  isPermission,
} from '../src/rbac/index';

describe('the permission catalogue', () => {
  it('is a fixed list with no duplicates', () => {
    expect(new Set(PERMISSIONS).size).toBe(PERMISSIONS.length);
  });

  it('recognises its own members and nothing else', () => {
    expect(isPermission('manage-roles')).toBe(true);
    expect(isPermission('manage_roles')).toBe(false);
    expect(isPermission('')).toBe(false);
    expect(isPermission('root')).toBe(false);
  });
});

describe('system roles', () => {
  it('gives an administrator every permission there is', () => {
    // If a permission is added to the catalogue and not to this role, the
    // tenant's own administrator silently cannot use the feature it guards.
    expect([...SYSTEM_ROLES.tenant_admin.permissions].sort()).toEqual(
      PERMISSIONS.filter((p) => p !== 'communities.unmask').sort(),
    );
    // Unmasking an anonymous author is never a default.
    expect(SYSTEM_ROLES.tenant_admin.permissions).not.toContain('communities.unmask');
  });

  it('gives an ordinary member nothing administrative', () => {
    for (const key of ['student', 'teacher'] as const) {
      const held = SYSTEM_ROLES[key].permissions;
      expect(held).toEqual(['post', 'communities.create']);
      expect(held).not.toContain('manage-roles');
      expect(held).not.toContain('approve-verifications');
    }
  });

  it('only ever names permissions that exist', () => {
    for (const key of SYSTEM_ROLE_KEYS) {
      for (const permission of SYSTEM_ROLES[key].permissions) {
        expect(isPermission(permission)).toBe(true);
      }
    }
  });
});

describe('PermissionSet', () => {
  const set = new PermissionSet(['manage-roles', 'post']);

  it('answers what is held, and refuses what is not', () => {
    expect(set.has('manage-roles')).toBe(true);
    expect(set.has('moderate')).toBe(false);
  });

  it('answers all and any', () => {
    expect(set.hasAll('manage-roles', 'post')).toBe(true);
    expect(set.hasAll('manage-roles', 'moderate')).toBe(false);
    expect(set.hasAny('moderate', 'post')).toBe(true);
    expect(set.hasAny('moderate', 'view-analytics')).toBe(false);
  });

  it('ignores anything that is not a permission', () => {
    // A row from the database naming something the catalogue dropped must not
    // become a capability by accident.
    const stray = new PermissionSet(['manage-roles', 'not-a-permission']);
    expect(stray.toArray()).toEqual(['manage-roles']);
  });

  it('is empty for someone with nothing', () => {
    expect(NO_PERMISSIONS.size).toBe(0);
    for (const permission of PERMISSIONS) expect(NO_PERMISSIONS.has(permission)).toBe(false);
  });
});
