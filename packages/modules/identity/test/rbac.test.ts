import { describe, expect, it } from 'vitest';
import { SYSTEM_ROLE_KEYS } from '@campusos/core';
import { ROLE_KEY_PATTERN, roleKeyFromName } from '../src/rbac';

describe('roleKeyFromName', () => {
  it('turns a name into a hyphenated key', () => {
    expect(roleKeyFromName('Course Rep')).toBe('course-rep');
    expect(roleKeyFromName('  Moderator ')).toBe('moderator');
    expect(roleKeyFromName('Year 2 (Evening)')).toBe('year-2-evening');
  });

  it('refuses a name with nothing usable in it', () => {
    expect(roleKeyFromName('')).toBeNull();
    expect(roleKeyFromName('   ')).toBeNull();
    expect(roleKeyFromName('!!!')).toBeNull();
  });

  it('derives hyphenated keys, so only an underscore free system key can be named', () => {
    // "Tenant Admin" becomes a distinct key and can never shadow the built in
    // role. "Student" derives the very key the built in role holds; createRole
    // then refuses it as `exists` at the unique index, which the integration
    // suite pins.
    expect(roleKeyFromName('Tenant Admin')).toBe('tenant-admin');
    expect(roleKeyFromName('Student')).toBe('student');
    for (const key of SYSTEM_ROLE_KEYS) {
      expect(ROLE_KEY_PATTERN.test(key)).toBe(!key.includes('_'));
    }
  });

  it('caps the key length without leaving a trailing hyphen', () => {
    const key = roleKeyFromName('a'.repeat(39) + ' b');
    expect(key).toBe('a'.repeat(39));
  });
});
