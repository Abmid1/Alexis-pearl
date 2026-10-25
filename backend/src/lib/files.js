import { randomUUID } from 'node:crypto';
import { db } from '../db.js';

/**
 * Private document handling.
 *
 *  - Files arrive as base64 in JSON (same transport the app already uses for receipts),
 *    capped at 8 MB decoded.
 *  - The type is decided by the file's real leading bytes ("magic numbers"), not by
 *    its name or the type the browser claims. Only PDF, JPEG, PNG and WebP are accepted.
 *  - Files go to a PRIVATE Supabase Storage bucket under <company>/<scope>/<random>,
 *    where scope is e.g. "applications/<id>" or "document-requests/<id>".
 *    They are only ever handed out as signed URLs that expire after 60 seconds,
 *    created after the caller's access has been checked.
 *  - No malware scanner is wired in. Accepting only these formats (no Office files,
 *    archives or executables) limits the risk; add a scanning service before scaling.
 */

export const BUCKET = 'application-documents';
export const MAX_BYTES = 8 * 1024 * 1024;

const SIGNATURES = [
  { mime: 'application/pdf', ext: 'pdf', test: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-' },
  { mime: 'image/jpeg', ext: 'jpg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/png', ext: 'png', test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/webp', ext: 'webp', test: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
];

export class FileError extends Error {
  constructor(message) { super(message); this.status = 400; }
}

/** Decode + validate an upload. Returns { buffer, mime, ext, fileName, size }. */
export function readUpload({ content_base64: b64, file_name: name } = {}) {
  if (typeof b64 !== 'string' || !b64) throw new FileError('Choose a file to upload');
  const clean = b64.replace(/^data:[^;,]+;base64,/, '');
  if (clean.length > Math.ceil(MAX_BYTES / 3) * 4 + 8) throw new FileError('File is larger than 8 MB');
  if (!/^[A-Za-z0-9+/=\r\n]+$/.test(clean)) throw new FileError('File could not be read');
  const buffer = Buffer.from(clean, 'base64');
  if (!buffer.length) throw new FileError('File is empty');
  if (buffer.length > MAX_BYTES) throw new FileError('File is larger than 8 MB');
  const kind = SIGNATURES.find((s) => s.test(buffer));
  if (!kind) throw new FileError('Only PDF, JPG, PNG or WebP files can be uploaded');
  const base = String(name || 'document').split(/[\\/]/).pop().replace(/[^\w.\- ()]/g, '_').slice(0, 120) || 'document';
  const fileName = base.toLowerCase().endsWith(`.${kind.ext}`) ? base : `${base.replace(/\.[^.]*$/, '')}.${kind.ext}`;
  return { buffer, mime: kind.mime, ext: kind.ext, fileName, size: buffer.length };
}

/** Store a validated file privately. Returns the storage path. */
export async function storePrivate(companyId, scope, file) {
  const safeScope = String(scope).replace(/[^\w/-]/g, '');
  const path = `${companyId}/${safeScope}/${randomUUID()}.${file.ext}`;
  const { error } = await db.storage.from(BUCKET).upload(path, file.buffer, { contentType: file.mime, upsert: false });
  if (error) throw new Error(`storage upload failed: ${error.message}`);
  return path;
}

/** Short-lived download link — only call after an access check. */
export async function signedUrl(path, seconds = 60) {
  const { data, error } = await db.storage.from(BUCKET).createSignedUrl(path, seconds);
  if (error || !data?.signedUrl) throw new Error(`could not create download link: ${error?.message || 'unknown'}`);
  return data.signedUrl;
}

export async function removePrivate(paths) {
  if (!paths.length) return;
  await db.storage.from(BUCKET).remove(paths);
}
