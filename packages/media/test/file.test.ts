import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAX_FILE_BYTES,
  FileError,
  newFileKey,
  resolveFileType,
  safeDownloadName,
  sniffFileFamily,
  validateUploadFile,
} from '../src/file';

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]); // %PDF-1.7
const ZIP = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]); // PK..
const NOISE = new Uint8Array([0x00, 0x01, 0x02, 0x03]);

describe('sniffFileFamily', () => {
  it('recognises PDF and ZIP-container leading bytes, and nothing else', () => {
    expect(sniffFileFamily(PDF)).toBe('pdf');
    expect(sniffFileFamily(ZIP)).toBe('zip');
    expect(sniffFileFamily(NOISE)).toBeNull();
    expect(sniffFileFamily(new Uint8Array([0x50, 0x4b]))).toBeNull(); // too short
  });
});

describe('resolveFileType', () => {
  it('maps by content-type first, then by filename extension', () => {
    expect(resolveFileType('application/pdf', null)?.ext).toBe('pdf');
    expect(resolveFileType('application/pdf; charset=binary', null)?.ext).toBe('pdf');
    expect(resolveFileType(null, 'report.docx')?.ext).toBe('docx');
    expect(resolveFileType('application/octet-stream', 'archive.zip')?.ext).toBe('zip');
    expect(resolveFileType('text/html', 'evil.html')).toBeNull();
  });
});

describe('validateUploadFile', () => {
  it('accepts a real PDF declared as PDF', () => {
    const res = validateUploadFile(PDF, { declaredType: 'application/pdf', filename: 'a.pdf' });
    expect(res.type.ext).toBe('pdf');
    expect(res.byteSize).toBe(PDF.byteLength);
  });

  it('accepts a docx (a ZIP container) by extension', () => {
    const res = validateUploadFile(ZIP, { filename: 'essay.docx' });
    expect(res.type.ext).toBe('docx');
    expect(res.type.family).toBe('zip');
  });

  it('rejects a disallowed type', () => {
    expect(() =>
      validateUploadFile(PDF, { declaredType: 'text/html', filename: 'x.html' }),
    ).toThrow(FileError);
  });

  it('rejects bytes that do not match the declared type (a PDF renamed .docx)', () => {
    try {
      validateUploadFile(PDF, { filename: 'trick.docx' });
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(FileError);
      expect((e as FileError).code).toBe('type_mismatch');
    }
  });

  it('rejects an oversized file before sniffing', () => {
    const big = new Uint8Array(DEFAULT_MAX_FILE_BYTES + 1);
    try {
      validateUploadFile(big, { declaredType: 'application/pdf', filename: 'big.pdf' });
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as FileError).code).toBe('too_large');
    }
  });
});

describe('newFileKey / safeDownloadName', () => {
  it('builds a sharded key keeping the extension', () => {
    const key = newFileKey('delivery', 'pdf');
    expect(key).toMatch(/^delivery\/[0-9a-f]{2}\/[0-9a-f-]{36}\.pdf$/);
  });

  it('strips path and control characters and forces the extension', () => {
    expect(safeDownloadName('../../etc/passwd', 'pdf')).toBe('passwd.pdf');
    expect(safeDownloadName('my report.docx', 'docx')).toBe('my report.docx');
    expect(safeDownloadName('', 'zip')).toBe('download.zip');
    expect(safeDownloadName('has"quote', 'pdf')).toBe('hasquote.pdf');
  });
});
