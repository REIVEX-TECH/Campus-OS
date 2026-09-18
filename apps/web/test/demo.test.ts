import { describe, expect, it } from 'vitest';
import { demoReadOnly } from '@/lib/demo';

/**
 * The demo read-only boundary (docs/design-demo-tenant.md, H). demoReadOnly is the
 * single choke point every mutation gate calls, so testing it here proves the rule
 * for all of communities, lost-found, marketplace, rides, and messages at once: a
 * real signed-in user cannot mutate on a demo tenant, seeded personas can, and no
 * ordinary tenant (LGU) is affected. Reads never reach this function.
 */
describe('demoReadOnly', () => {
  const persona = { isDemo: true };
  const realUser = { isDemo: false };

  it('blocks a real user on a demo tenant with a 403', () => {
    const res = demoReadOnly({ isDemo: true }, realUser);
    expect(res).not.toBeNull();
    expect(res?.status).toBe(403);
  });

  it('allows a seeded persona on a demo tenant', () => {
    expect(demoReadOnly({ isDemo: true }, persona)).toBeNull();
  });

  it('does not affect an ordinary (non-demo) tenant for a real user', () => {
    expect(demoReadOnly({ isDemo: false }, realUser)).toBeNull();
  });

  it('does not affect an ordinary tenant for a persona either', () => {
    expect(demoReadOnly({ isDemo: false }, persona)).toBeNull();
  });

  it('names the refusal so the client can tell it apart', async () => {
    const res = demoReadOnly({ isDemo: true }, realUser);
    expect(res).not.toBeNull();
    const body = (await res!.json()) as { error?: string };
    expect(body.error).toBe('demo_read_only');
  });
});
