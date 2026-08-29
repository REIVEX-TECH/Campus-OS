import { err, ok, type Result } from '@campusos/core';
import {
  NormalizeError,
  SourceError,
  type NormalizedBatch,
  type RawTimetablePayload,
  type SourceHealth,
  type TimetableSource,
} from '@campusos/core/ingestion';
import { loadConfig, SOURCE_ID, type AdapterConfig } from './config';
import { fetchAll, type RawRecords } from './fetch';
import { createFixtureHttpClient, createLiveHttpClient, type HttpClient } from './http';
import { normalizeRecords } from './normalize';
import { establishSession } from './session';

export interface LguSourceOptions {
  config?: AdapterConfig;
  /** Inject an HTTP client (tests pass a fixture client → zero network). */
  http?: HttpClient;
  logger?: (message: string) => void;
}

export class LguTimetableSource implements TimetableSource {
  readonly id = SOURCE_ID;
  private readonly config: AdapterConfig;
  private readonly injectedHttp?: HttpClient;
  private readonly log: (message: string) => void;

  constructor(options: LguSourceOptions = {}) {
    this.config = options.config ?? loadConfig();
    this.injectedHttp = options.http;
    this.log = options.logger ?? ((message) => console.log(`[${SOURCE_ID}] ${message}`));
  }

  private client(): HttpClient {
    if (this.injectedHttp) return this.injectedHttp;
    if (this.config.mode === 'fixture') return createFixtureHttpClient(this.config.fixturesDir);
    return createLiveHttpClient({ 'user-agent': this.config.userAgent });
  }

  async healthCheck(): Promise<Result<SourceHealth, SourceError>> {
    try {
      const res = await this.client().get(`${this.config.baseUrl}/api/metadata`, {
        headers: { 'user-agent': this.config.userAgent },
      });
      return ok({ ok: res.ok, detail: `status ${res.status}` });
    } catch (error) {
      return err(new SourceError('health check failed', error));
    }
  }

  async fetchRaw(): Promise<Result<RawTimetablePayload, SourceError>> {
    try {
      const http = this.client();
      let cookie: string | null = null;

      if (this.config.mode === 'live' && !this.injectedHttp) {
        const session = await establishSession(http, this.config, this.log);
        cookie = session.cookie;
      } else {
        this.log('session path=fixture');
      }

      const records = await fetchAll(http, this.config, cookie);
      return ok({ source: this.id, fetchedAt: new Date().toISOString(), records });
    } catch (error) {
      return err(new SourceError('fetch failed', error));
    }
  }

  normalize(raw: RawTimetablePayload): Result<NormalizedBatch, NormalizeError> {
    try {
      return ok(normalizeRecords(raw.records as RawRecords));
    } catch (error) {
      return err(new NormalizeError('normalize failed', error));
    }
  }
}

export function createLguSource(options: LguSourceOptions = {}): LguTimetableSource {
  return new LguTimetableSource(options);
}
