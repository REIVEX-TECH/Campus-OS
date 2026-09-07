import { randomUUID } from 'node:crypto';

/**
 * Non-image file intake, for order deliveries and the like. Unlike photos, these
 * are stored as sent (we do not re-encode a PDF), so the guardrails are: a small
 * content-type allowlist, a real magic-byte check on the bytes (never trust the
 * client's declared type), and a size cap. The serving layer MUST send these with
 * `Content-Disposition: attachment` and never inline, so a file can only ever be
 * downloaded, never rendered in the origin (the allowlist already excludes
 * HTML/SVG, but attachment is the belt-and-braces).
 */

export type FileFamily = 'pdf' | 'zip';

export interface AllowedFileType {
  ext: string;
  contentType: string;
  family: FileFamily;
}

/**
 * What a delivery may contain. docx/xlsx/pptx are ZIP containers, so their bytes
 * sniff as 'zip'; the specific type comes from the declared content-type or the
 * filename extension, and must be one of these.
 */
export const ALLOWED_FILE_TYPES: readonly AllowedFileType[] = [
  { ext: 'pdf', contentType: 'application/pdf', family: 'pdf' },
  { ext: 'zip', contentType: 'application/zip', family: 'zip' },
  {
    ext: 'docx',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    family: 'zip',
  },
  {
    ext: 'xlsx',
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    family: 'zip',
  },
  {
    ext: 'pptx',
    contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    family: 'zip',
  },
] as const;

/** 25 MiB, the default cap for a delivery file. */
export const DEFAULT_MAX_FILE_BYTES = 25 * 1024 * 1024;

export class FileError extends Error {
  constructor(readonly code: 'unsupported_type' | 'too_large' | 'type_mismatch') {
    super(code);
    this.name = 'FileError';
  }
}

/** Sniff the true container family from the leading bytes, or null if neither. */
export function sniffFileFamily(bytes: Uint8Array): FileFamily | null {
  // %PDF
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46
  ) {
    return 'pdf';
  }
  // PK\x03\x04 (local file header), or the empty/spanned markers PK\x05\x06 / PK\x07\x08.
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const c = bytes[2];
    const d = bytes[3];
    if ((c === 0x03 && d === 0x04) || (c === 0x05 && d === 0x06) || (c === 0x07 && d === 0x08)) {
      return 'zip';
    }
  }
  return null;
}

function extensionOf(filename: string | undefined | null): string | null {
  if (!filename) return null;
  const dot = filename.lastIndexOf('.');
  if (dot < 0 || dot === filename.length - 1) return null;
  return filename.slice(dot + 1).toLowerCase();
}

/** Resolve the allowed type from the declared content-type, else the filename. */
export function resolveFileType(
  declaredType: string | undefined | null,
  filename: string | undefined | null,
): AllowedFileType | null {
  const ct = declaredType?.split(';')[0]?.trim().toLowerCase();
  if (ct) {
    const byType = ALLOWED_FILE_TYPES.find((t) => t.contentType === ct);
    if (byType) return byType;
  }
  const ext = extensionOf(filename);
  if (ext) {
    const byExt = ALLOWED_FILE_TYPES.find((t) => t.ext === ext);
    if (byExt) return byExt;
  }
  return null;
}

export interface ValidatedFile {
  type: AllowedFileType;
  byteSize: number;
}

/**
 * Validate an uploaded non-image file. Enforces the size cap, resolves the type
 * from the declared content-type or filename against the allowlist, and checks the
 * bytes actually match that type's family. Throws {@link FileError} otherwise.
 */
export function validateUploadFile(
  input: Uint8Array,
  opts: { declaredType?: string | null; filename?: string | null; maxBytes?: number } = {},
): ValidatedFile {
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_FILE_BYTES;
  if (input.byteLength > maxBytes) throw new FileError('too_large');
  const type = resolveFileType(opts.declaredType, opts.filename);
  if (!type) throw new FileError('unsupported_type');
  const family = sniffFileFamily(input);
  if (family === null || family !== type.family) throw new FileError('type_mismatch');
  return { type, byteSize: input.byteLength };
}

/**
 * A fresh key for one stored file, keeping its real extension, fanned out one
 * level to keep directories small. Unlike photos there is no thumbnail.
 */
export function newFileKey(prefix: string, ext: string): string {
  const id = randomUUID();
  return `${prefix}/${id.slice(0, 2)}/${id}.${ext}`;
}

/**
 * A safe filename for the `Content-Disposition: attachment` header: strip any path,
 * control characters, and the double-quote that would break the header; keep a
 * modest length and ensure the right extension.
 */
export function safeDownloadName(name: string | undefined | null, ext: string): string {
  // Intentionally matches control characters, to strip them from a header value.
  // eslint-disable-next-line no-control-regex
  const controls = new RegExp('[\\u0000-\\u001f"]', 'g');
  // Take the basename (drop any path), then strip control characters and quotes.
  const basename = (name ?? '').split(/[/\\]/).pop() ?? '';
  const cleaned = basename.replace(controls, '').trim().slice(0, 120);
  const stem = cleaned.replace(new RegExp(`\\.${ext}$`, 'i'), '').trim() || 'download';
  return `${stem}.${ext}`;
}
