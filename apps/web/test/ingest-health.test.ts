import { describe, expect, it } from 'vitest';
import { evaluateIngestHealth } from '@/lib/ingest-health';

const now = new Date('2026-09-28T12:00:00Z');
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();

describe('evaluateIngestHealth', () => {
  it('is ok when the last successful run is within the window', () => {
    const r = evaluateIngestHealth([{ slug: 'lgu', lastSuccessfulAt: hoursAgo(6) }], now, 14);
    expect(r.ok).toBe(true);
    expect(r.tenants[0]).toMatchObject({ slug: 'lgu', stale: false, ageHours: 6 });
  });

  it('is stale (and not ok) past the window, e.g. the 22-day failure', () => {
    const r = evaluateIngestHealth([{ slug: 'lgu', lastSuccessfulAt: hoursAgo(22 * 24) }], now, 14);
    expect(r.ok).toBe(false);
    expect(r.tenants[0]!.stale).toBe(true);
  });

  it('does not flag a never-ingested tenant (null is reported, not stale)', () => {
    const r = evaluateIngestHealth([{ slug: 'demo', lastSuccessfulAt: null }], now, 14);
    expect(r.ok).toBe(true);
    expect(r.tenants[0]).toMatchObject({ slug: 'demo', ageHours: null, stale: false });
  });

  it('is stale as soon as one monitored tenant is, and names each', () => {
    const r = evaluateIngestHealth(
      [
        { slug: 'lgu', lastSuccessfulAt: hoursAgo(2) },
        { slug: 'other', lastSuccessfulAt: hoursAgo(30) },
      ],
      now,
      14,
    );
    expect(r.ok).toBe(false);
    expect(r.tenants.find((t) => t.slug === 'lgu')!.stale).toBe(false);
    expect(r.tenants.find((t) => t.slug === 'other')!.stale).toBe(true);
  });

  it('respects the boundary: just under the window is fresh, just over is stale', () => {
    expect(
      evaluateIngestHealth([{ slug: 'a', lastSuccessfulAt: hoursAgo(13.9) }], now, 14).ok,
    ).toBe(true);
    expect(
      evaluateIngestHealth([{ slug: 'a', lastSuccessfulAt: hoursAgo(14.1) }], now, 14).ok,
    ).toBe(false);
  });
});
