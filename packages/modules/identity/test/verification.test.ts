import { describe, expect, it } from 'vitest';
import { verificationDetailsSchema } from '../src/verification';

describe('verificationDetailsSchema', () => {
  it('accepts the three things an admin can check', () => {
    const parsed = verificationDetailsSchema.safeParse({
      fullName: '  Ayesha Khan ',
      rollNumber: 'FA21-BSCS-042',
      note: '',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.fullName).toBe('Ayesha Khan');
      expect(parsed.data.rollNumber).toBe('FA21-BSCS-042');
      // An empty note is no note, not an empty string to store.
      expect(parsed.data.note).toBeUndefined();
    }
  });

  it('keeps a real note', () => {
    const parsed = verificationDetailsSchema.parse({
      fullName: 'Ayesha Khan',
      rollNumber: '042',
      note: 'Transferred from the Lahore campus in 2024.',
    });
    expect(parsed.note).toBe('Transferred from the Lahore campus in 2024.');
  });

  it('refuses what cannot be checked', () => {
    expect(verificationDetailsSchema.safeParse({ fullName: 'A', rollNumber: '042' }).success).toBe(
      false,
    );
    expect(
      verificationDetailsSchema.safeParse({ fullName: 'Ayesha Khan', rollNumber: '' }).success,
    ).toBe(false);
    // A roll number is letters, digits and light punctuation, not markup.
    expect(
      verificationDetailsSchema.safeParse({ fullName: 'Ayesha Khan', rollNumber: '<b>042</b>' })
        .success,
    ).toBe(false);
    expect(
      verificationDetailsSchema.safeParse({
        fullName: 'Ayesha Khan',
        rollNumber: '042',
        note: 'x'.repeat(501),
      }).success,
    ).toBe(false);
  });
});
