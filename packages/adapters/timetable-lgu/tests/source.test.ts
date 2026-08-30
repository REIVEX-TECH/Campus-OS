import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';
import { createFixtureHttpClient } from '../src/http';
import { LguTimetableSource } from '../src/source';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

describe('LguTimetableSource (fixture mode)', () => {
  it('fetches and normalizes from fixtures with zero live network calls', async () => {
    const http = createFixtureHttpClient(fixturesDir);
    const source = new LguTimetableSource({
      config: loadConfig({ SOURCE_MODE: 'fixture' }, fixturesDir),
      http,
      logger: () => {},
    });

    const raw = await source.fetchRaw();
    expect(raw.ok).toBe(true);
    if (!raw.ok) return;

    const normalized = source.normalize(raw.value);
    expect(normalized.ok).toBe(true);
    if (!normalized.ok) return;

    const batch = normalized.value;
    expect(batch.terms.map((t) => t.code)).toEqual(['Fall 2025']);
    expect(batch.programs.map((p) => p.code)).toEqual(['BSCS']);
    expect(batch.departments).toEqual([{ code: 'UNASSIGNED', name: 'Unassigned' }]);
    expect(batch.sections).toHaveLength(2);
    expect(batch.entries).toHaveLength(4);
    // "Seminar" is an unknown kind → recorded (never dropped), defaulted to lecture.
    expect(batch.unknowns).toContainEqual({ kind: 'entry_kind', rawValue: 'Seminar' });

    // Zero-network assertion: only the injected fixture client was used.
    expect(http.calls.length).toBeGreaterThan(0);
    expect(http.calls).toContain(
      `${loadConfig({ SOURCE_MODE: 'fixture' }, fixturesDir).baseUrl}/api/metadata`,
    );
  });
});
