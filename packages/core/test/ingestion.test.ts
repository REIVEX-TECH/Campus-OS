import { describe, expect, it } from 'vitest';
import { err, ok } from '../src/result';
import {
  runIngestion,
  SourceError,
  type IngestionSink,
  type NormalizedBatch,
  type TimetableSource,
} from '../src/ingestion/index';

const emptyBatch: NormalizedBatch = {
  terms: [],
  departments: [],
  programs: [],
  courses: [],
  teachers: [],
  sections: [],
  entries: [],
  unknowns: [],
};

function fakeSink(overrides: Partial<IngestionSink> = {}): IngestionSink & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    startRun: async () => {
      calls.push('start');
      return 'run-1';
    },
    recordSnapshot: async () => {
      calls.push('snapshot');
    },
    persist: async () => {
      calls.push('persist');
      return { inserted: 2, closed: 0, unchanged: 0, unknowns: 0 };
    },
    finishRun: async (_id, status) => {
      calls.push(`finish:${status}`);
    },
    ...overrides,
  };
}

const okSource: TimetableSource = {
  id: 'test',
  healthCheck: async () => ok({ ok: true }),
  fetchRaw: async () => ok({ source: 'test', fetchedAt: '2026-01-01T00:00:00Z', records: [] }),
  normalize: () => ok(emptyBatch),
};

describe('runIngestion', () => {
  it('runs fetch → snapshot → persist → finish(success)', async () => {
    const sink = fakeSink();
    const result = await runIngestion(okSource, sink);
    expect(result.ok).toBe(true);
    expect(sink.calls).toEqual(['start', 'snapshot', 'persist', 'finish:success']);
  });

  it('fails the run and skips persist when fetch fails', async () => {
    const sink = fakeSink();
    const badSource: TimetableSource = {
      ...okSource,
      fetchRaw: async () => err(new SourceError('boom')),
    };
    const result = await runIngestion(badSource, sink);
    expect(result.ok).toBe(false);
    expect(sink.calls).toEqual(['start', 'finish:failed']);
  });

  it('fails the run if persist throws (no partial success)', async () => {
    const sink = fakeSink({
      persist: async () => {
        throw new Error('db down');
      },
    });
    const result = await runIngestion(okSource, sink);
    expect(result.ok).toBe(false);
    expect(sink.calls).toContain('finish:failed');
  });
});
