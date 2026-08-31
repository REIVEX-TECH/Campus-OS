import { describe, expect, it } from 'vitest';
import { checkAdminPassword, signAdminToken, verifyAdminToken } from '../lib/admin-token';

// The admin gate that both requireAdmin (pages) and the mutation route handlers
// rely on. If this logic is sound, an unauthenticated request carries no valid
// token and is rejected server-side, not merely hidden in the UI.
const SECRET = 'a_test_admin_secret_value';

describe('admin token gate', () => {
  it('accepts a token signed for the same tenant and secret', () => {
    expect(verifyAdminToken(signAdminToken('lgu', SECRET), 'lgu', SECRET)).toBe(true);
  });

  it('rejects a missing or empty token', () => {
    expect(verifyAdminToken(undefined, 'lgu', SECRET)).toBe(false);
    expect(verifyAdminToken('', 'lgu', SECRET)).toBe(false);
  });

  it('rejects a token issued for a different tenant', () => {
    expect(verifyAdminToken(signAdminToken('other', SECRET), 'lgu', SECRET)).toBe(false);
  });

  it('rejects a token signed with the wrong secret', () => {
    expect(verifyAdminToken(signAdminToken('lgu', 'wrong'), 'lgu', SECRET)).toBe(false);
  });

  it('rejects a forged token', () => {
    expect(verifyAdminToken('deadbeef', 'lgu', SECRET)).toBe(false);
  });

  it('checks the admin password exactly', () => {
    expect(checkAdminPassword(SECRET, SECRET)).toBe(true);
    expect(checkAdminPassword('nope', SECRET)).toBe(false);
    expect(checkAdminPassword('', SECRET)).toBe(false);
  });
});
