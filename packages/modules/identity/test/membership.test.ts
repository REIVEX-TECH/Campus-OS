import { describe, expect, it } from 'vitest';
import { domainAllowed, emailDomain, isVerified } from '../src/membership';

describe('emailDomain', () => {
  it('lower cases the domain and ignores the local part', () => {
    expect(emailDomain('Someone@LGU.edu.pk')).toBe('lgu.edu.pk');
  });

  it('is null for anything that is not an address', () => {
    expect(emailDomain('no-at-sign')).toBeNull();
    expect(emailDomain('@lgu.edu.pk')).toBeNull();
    expect(emailDomain('someone@')).toBeNull();
  });
});

describe('domainAllowed', () => {
  const allowed = ['lgu.edu.pk'];

  it('accepts an address on the list, whatever its case', () => {
    expect(domainAllowed('a@lgu.edu.pk', allowed)).toBe(true);
    expect(domainAllowed('A@LGU.EDU.PK', allowed)).toBe(true);
    expect(domainAllowed('a@lgu.edu.pk', ['LGU.EDU.PK'])).toBe(true);
  });

  it('refuses everything else, including look alikes', () => {
    expect(domainAllowed('a@gmail.com', allowed)).toBe(false);
    // A subdomain of the university is not the university.
    expect(domainAllowed('a@mail.lgu.edu.pk', allowed)).toBe(false);
    // Nor is a domain that merely ends the same way.
    expect(domainAllowed('a@notlgu.edu.pk', allowed)).toBe(false);
    expect(domainAllowed('a@lgu.edu.pk.evil.com', allowed)).toBe(false);
  });

  it('refuses everyone when the tenant lists no domains', () => {
    expect(domainAllowed('a@lgu.edu.pk', [])).toBe(false);
  });
});

describe('isVerified', () => {
  const base = {
    id: 'm',
    tenantId: 'lgu',
    role: 'student',
    status: 'active',
    verifiedAt: new Date(),
    verificationMethod: 'domain' as const,
  };

  it('needs both a verification and good standing', () => {
    expect(isVerified(base)).toBe(true);
    expect(isVerified({ ...base, verifiedAt: null })).toBe(false);
    expect(isVerified({ ...base, status: 'suspended' })).toBe(false);
    expect(isVerified(null)).toBe(false);
  });
});
