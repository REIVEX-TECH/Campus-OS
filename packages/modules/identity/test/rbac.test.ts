import { describe, expect, it } from 'vitest';
import { SYSTEM_ROLE_KEYS } from '@campusos/core';
import { TEMPLATE_KEY_PATTERN, templateKeyFromName } from '../src/role-templates';

describe('templateKeyFromName', () => {
  it('turns a name into a hyphenated key', () => {
    expect(templateKeyFromName('Course Rep')).toBe('course-rep');
    expect(templateKeyFromName('  Moderator ')).toBe('moderator');
    expect(templateKeyFromName('Year 2 (Evening)')).toBe('year-2-evening');
  });

  it('refuses a name with nothing usable in it', () => {
    expect(templateKeyFromName('')).toBeNull();
    expect(templateKeyFromName('   ')).toBeNull();
    expect(templateKeyFromName('!!!')).toBeNull();
  });

  it('derives hyphenated keys, so only an underscore free system key can be named', () => {
    // "Tenant Admin" becomes a distinct key and can never shadow the built in
    // role. "Student" derives the very key the built in role holds; creating one
    // then refuses it as `exists` at the unique index, which the integration
    // suite pins.
    expect(templateKeyFromName('Tenant Admin')).toBe('tenant-admin');
    expect(templateKeyFromName('Student')).toBe('student');
    for (const key of SYSTEM_ROLE_KEYS) {
      expect(TEMPLATE_KEY_PATTERN.test(key)).toBe(!key.includes('_'));
    }
  });

  it('caps the key length without leaving a trailing hyphen', () => {
    const key = templateKeyFromName('a'.repeat(39) + ' b');
    expect(key).toBe('a'.repeat(39));
  });
});
