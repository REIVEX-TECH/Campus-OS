import { err, ok, type Result } from '../result';
import type { IngestionStats, NormalizedBatch } from './dto';
import { IngestionError } from './errors';
import type { RawTimetablePayload, TimetableSource } from './source';

export type IngestionRunStatus = 'success' | 'failed';

/**
 * Persistence port. Adapters never touch this; the concrete implementation
 * lives in the timetable module (which owns the schema). Keeping it an
 * interface here lets core orchestrate ingestion without a DB dependency on any
 * module.
 */
export interface IngestionSink {
  startRun(source: string): Promise<string>;
  recordSnapshot(runId: string, raw: RawTimetablePayload): Promise<void>;
  persist(batch: NormalizedBatch, ctx: { runId: string; source: string }): Promise<IngestionStats>;
  finishRun(
    runId: string,
    status: IngestionRunStatus,
    stats: IngestionStats | null,
    error?: string,
  ): Promise<void>;
}

export interface RunResult {
  runId: string;
  status: IngestionRunStatus;
  stats: IngestionStats;
}

export interface RunOptions {
  logger?: (message: string) => void;
}

/**
 * The generic ingestion pipeline: fetchRaw → snapshot → normalize → persist
 * (diff + versioned upsert, in the sink's transaction) → record the run. Any
 * failure marks the run failed and writes nothing else (no partial state).
 */
export async function runIngestion(
  source: TimetableSource,
  sink: IngestionSink,
  options: RunOptions = {},
): Promise<Result<RunResult, IngestionError>> {
  const log = options.logger ?? (() => {});
  const runId = await sink.startRun(source.id);

  try {
    const raw = await source.fetchRaw();
    if (!raw.ok) {
      await sink.finishRun(runId, 'failed', null, raw.error.message);
      return err(new IngestionError(`fetch failed: ${raw.error.message}`, raw.error));
    }

    await sink.recordSnapshot(runId, raw.value);

    const normalized = source.normalize(raw.value);
    if (!normalized.ok) {
      await sink.finishRun(runId, 'failed', null, normalized.error.message);
      return err(
        new IngestionError(`normalize failed: ${normalized.error.message}`, normalized.error),
      );
    }

    log(
      `persisting ${normalized.value.entries.length} entries (${normalized.value.unknowns.length} unknown)`,
    );
    const stats = await sink.persist(normalized.value, { runId, source: source.id });
    await sink.finishRun(runId, 'success', stats);
    return ok({ runId, status: 'success', stats });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    await sink.finishRun(runId, 'failed', null, message);
    return err(new IngestionError(`ingestion crashed: ${message}`, error));
  }
}
