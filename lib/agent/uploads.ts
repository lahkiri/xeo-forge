/**
 * Upload validation — whitelist-based classification and limit constants.
 *
 * Single source of truth for what may be ingested. Whitelist only: anything
 * not explicitly classified is rejected (no guessing, no partial processing).
 * Uploaded content is always treated as inert DATA, never executed.
 */

import type { UploadKind } from '../types';

/* ── Hard limits (defense against archive bombs / oversized abuse) ── */

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB per uploaded file/archive
export const MAX_EXTRACTED_BYTES = 100 * 1024 * 1024; // 100 MB total extracted
export const MAX_FILE_COUNT = 2000; // max entries extracted from one archive
export const MAX_NESTING_DEPTH = 16; // max path depth inside an archive
export const MAX_SINGLE_ENTRY_BYTES = 25 * 1024 * 1024; // max one extracted file

/* ── Whitelist: extension → kind ── */

const TEXT_EXTS = new Set([
  '.txt', '.text', '.log', '.rst', '.ini', '.cfg', '.conf', '.env.example',
  '.toml', '.yaml', '.yml', '.xml', '.html', '.htm', '.css', '.scss', '.sql',
]);

const CODE_EXTS = new Set([
  '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.py', '.rb', '.go', '.rs',
  '.java', '.kt', '.c', '.h', '.cpp', '.hpp', '.cc', '.cs', '.php', '.swift',
  '.sh', '.bash', '.zsh', '.pl', '.lua', '.r', '.dart', '.scala', '.clj',
  '.ex', '.exs', '.erl', '.hs', '.ml', '.vue', '.svelte', '.gradle',
]);

const MARKDOWN_EXTS = new Set(['.md', '.markdown', '.mdx']);
const JSON_EXTS = new Set(['.json', '.jsonl', '.geojson', '.ndjson']);
const CSV_EXTS = new Set(['.csv', '.tsv']);

const ARCHIVE_SUFFIXES = ['.tar.gz', '.tgz', '.tar', '.zip'];

/* ── Known-good extensionless filenames (config/docs only, treated as text) ── */
const TEXT_BASENAMES = new Set([
  'readme', 'license', 'licence', 'changelog', 'authors', 'contributors',
  'makefile', 'dockerfile', '.gitignore', '.dockerignore', '.editorconfig',
  '.npmrc', '.nvmrc', '.prettierrc', '.eslintrc',
]);

function lower(s: string): string {
  return s.toLowerCase();
}

/** Return the archive suffix if the filename is a supported archive, else null. */
export function archiveSuffix(filename: string): string | null {
  const f = lower(filename);
  for (const suf of ARCHIVE_SUFFIXES) {
    if (f.endsWith(suf)) return suf;
  }
  return null;
}

function extOf(filename: string): string {
  const f = lower(filename);
  const dot = f.lastIndexOf('.');
  if (dot <= 0) return '';
  return f.slice(dot);
}

/**
 * Classify a filename to an allowed UploadKind, or null if not whitelisted.
 * Whitelist-only: unknown types are rejected by the caller.
 */
export function classifyUpload(filename: string): UploadKind | null {
  const base = lower(filename.split('/').pop() || filename);
  if (archiveSuffix(filename)) return 'archive';

  const ext = extOf(base);
  if (MARKDOWN_EXTS.has(ext)) return 'markdown';
  if (JSON_EXTS.has(ext)) return 'json';
  if (CSV_EXTS.has(ext)) return 'csv';
  if (CODE_EXTS.has(ext)) return 'code';
  if (TEXT_EXTS.has(ext)) return 'text';

  if (!ext && TEXT_BASENAMES.has(base)) return 'text';
  if (TEXT_BASENAMES.has(base)) return 'text';

  return null;
}

/**
 * Classify a file found INSIDE an archive. Same whitelist, but unknown types
 * are silently skipped (not fatal) — the archive as a whole is still accepted,
 * inert non-whitelisted entries are simply not indexed/extracted.
 */
export function classifyArchiveEntry(filename: string): UploadKind | null {
  // Nested archives are not recursively extracted; treat them as inert data only
  // if they happen to match, but do not classify as 'archive' (no auto re-extract).
  const base = lower(filename.split('/').pop() || filename);
  const ext = extOf(base);
  if (MARKDOWN_EXTS.has(ext)) return 'markdown';
  if (JSON_EXTS.has(ext)) return 'json';
  if (CSV_EXTS.has(ext)) return 'csv';
  if (CODE_EXTS.has(ext)) return 'code';
  if (TEXT_EXTS.has(ext)) return 'text';
  if (!ext && TEXT_BASENAMES.has(base)) return 'text';
  return null;
}

/** True if the kind is an archive that needs extraction. */
export function isArchive(kind: UploadKind): boolean {
  return kind === 'archive';
}

export class UploadRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UploadRejectedError';
  }
}

/**
 * Validate a path entry from an archive for traversal / absolute / depth abuse.
 * Returns a normalized relative POSIX path, or throws UploadRejectedError.
 * This is a STRING-level pre-check; the realpath boundary check in archive.ts
 * (via resolveWithin) is the authoritative enforcement.
 */
export function sanitizeEntryPath(entryName: string): string {
  if (!entryName || entryName.trim() === '') {
    throw new UploadRejectedError('Archive entry has empty name');
  }
  // Normalize separators
  let name = entryName.replace(/\\/g, '/');
  // Reject absolute paths
  if (name.startsWith('/')) {
    throw new UploadRejectedError(`Archive entry has absolute path: ${entryName}`);
  }
  // Reject Windows drive absolute (C:\)
  if (/^[a-zA-Z]:/.test(name)) {
    throw new UploadRejectedError(`Archive entry has drive-absolute path: ${entryName}`);
  }
  // Strip a single leading ./
  name = name.replace(/^\.\//, '');
  // Reject any parent-traversal segment
  const segments = name.split('/');
  for (const seg of segments) {
    if (seg === '..') {
      throw new UploadRejectedError(`Archive entry attempts path traversal: ${entryName}`);
    }
  }
  // Reject NUL bytes
  if (name.includes('\0')) {
    throw new UploadRejectedError(`Archive entry has NUL byte: ${entryName}`);
  }
  // Enforce nesting depth
  const depth = segments.filter((s) => s && s !== '.').length;
  if (depth > MAX_NESTING_DEPTH) {
    throw new UploadRejectedError(`Archive entry exceeds max nesting depth (${depth} > ${MAX_NESTING_DEPTH}): ${entryName}`);
  }
  return name;
}
