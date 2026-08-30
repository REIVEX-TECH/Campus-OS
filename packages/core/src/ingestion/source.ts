import type { Result } from '../result';
import type { NormalizedBatch } from './dto';
import type { NormalizeError, SourceError } from './errors';

export interface SourceHealth {
  ok: boolean;
  detail?: string;
}

/** Raw payload a source returns, kept opaque and archived as a snapshot. */
export interface RawTimetablePayload {
  source: string;
  /** ISO-8601 instant the fetch completed. */
  fetchedAt: string;
  records: unknown;
}

/**
 * A timetable data source (CLAUDE.md §4). Adapters implement this and are pure
 * with respect to the database — they only fetch and normalize; the pipeline's
 * sink persists.
 */
export interface TimetableSource {
  readonly id: string;
  healthCheck(): Promise<Result<SourceHealth, SourceError>>;
  fetchRaw(): Promise<Result<RawTimetablePayload, SourceError>>;
  normalize(raw: RawTimetablePayload): Result<NormalizedBatch, NormalizeError>;
}
