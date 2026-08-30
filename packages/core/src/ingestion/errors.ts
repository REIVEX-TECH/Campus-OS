/** A failure fetching or health-checking a source. */
export class SourceError extends Error {
  constructor(
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'SourceError';
  }
}

/** A failure turning raw source data into normalized records. */
export class NormalizeError extends Error {
  constructor(
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'NormalizeError';
  }
}

/** A failure of the ingestion pipeline as a whole. */
export class IngestionError extends Error {
  constructor(
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'IngestionError';
  }
}
