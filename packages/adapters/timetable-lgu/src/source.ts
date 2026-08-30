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
import { crawl, type RawRecords } from './fetch';
import { createFixtureHttpClient, createLiveHttpClient, type HttpClient } from './http';
import { normalizeRecords } from './normalize';
import { createAutonomousSession } from './session';

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

  private async client(): Promise<HttpClient> {
    if (this.injectedHttp) return this.injectedHttp;
    if (this.config.mode === 'fixture') return createFixtureHttpClient(this.config.fixturesDir);
    // live: autonomous session by default; env PHPSESSID only as an override.
    const cookie = this.config.phpSessId
      ? `PHPSESSID=${this.config.phpSessId}`
      : (await createAutonomousSession(this.config.baseUrl, this.config.userAgent)).cookie;
    this.log(this.config.phpSessId ? 'session: env override' : 'session: autonomous');
    return createLiveHttpClient(this.config.baseUrl, cookie, this.config.userAgent);
  }

  async healthCheck(): Promise<Result<SourceHealth, SourceError>> {
    try {
      if (this.config.mode !== 'live' || this.injectedHttp) {
        return ok({ ok: true, detail: 'fixture mode' });
      }
      await createAutonomousSession(this.config.baseUrl, this.config.userAgent);
      return ok({ ok: true, detail: 'anonymous session minted' });
    } catch (error) {
      return err(new SourceError('health check failed', error));
    }
  }

  async fetchRaw(): Promise<Result<RawTimetablePayload, SourceError>> {
    try {
      const http = await this.client();
      const records = await crawl(http, this.config);
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
