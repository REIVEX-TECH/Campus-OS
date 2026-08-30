import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';
import { createFixtureHttpClient } from '../src/http';
import { LguTimetableSource } from '../src/source';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

describe('LguTimetableSource (fixture mode, real portal HTML)', () => {
  it('crawls and normalizes the recorded fixtures with zero network calls', async () => {
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
    expect(batch.programs[0]?.name).toBe('BSCS');
    expect(batch.sections).toHaveLength(3);
    expect(batch.entries.length).toBeGreaterThan(0);
    expect(batch.terms[0]?.code).toContain('Semester');
    // zero-network proof: only the injected fixture client was read.
    expect(http.calls).toContain('semester-panel.html');
    expect(http.calls.length).toBeGreaterThan(3);
  });
});
