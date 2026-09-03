import { describe, expect, it } from 'vitest';
import { nextAvatarSeed } from '../src/avatar-seed';

// The shape the avatar route accepts. The web app pins the real contract against
// its own pattern; this is the module's own statement of what it promises.
const DRAWABLE = /^[A-Za-z0-9_.-]+$/;

describe('nextAvatarSeed', () => {
  const userId = '5f7a3c2e-9b1d-4e8f-a6c0-1234567890ab';

  it('is something the avatar route will draw', () => {
    expect(nextAvatarSeed(userId, 1_756_800_000_000)).toMatch(DRAWABLE);
  });

  it('is different at a different moment, and stable at the same one', () => {
    expect(nextAvatarSeed(userId, 1)).not.toBe(nextAvatarSeed(userId, 2));
    expect(nextAvatarSeed(userId, 7)).toBe(nextAvatarSeed(userId, 7));
  });

  it('is scoped to the user, so two people never share a picture by accident', () => {
    expect(nextAvatarSeed(userId, 1)).not.toBe(nextAvatarSeed('another-user', 1));
  });
});
