/**
 * Safe archive extraction — dependency-free tar, tar.gz/tgz, and zip.
 *
 * Security model (AGENTS.md §7 + upload task constraints):
 *  - Every entry path is string-checked (sanitizeEntryPath) AND realpath-checked
 *    against the destination root via resolveWithin (the SAME primitive FileTool
 *    uses — single boundary implementation, no second path system).
 *  - Symlinks, hardlinks, device/char/fifo nodes are REJECTED, never created.
 *  - Absolute paths and `..` traversal are REJECTED.
 *  - Aggregate limits (total bytes, file count, per-entry bytes) bound bomb risk.
 *  - Nested archives are NOT recursively extracted (stored inert as data).
 *  - Files are written with raw fs but ONLY to resolveWithin-validated paths.
 *  - Nothing extracted is ever executed.
 */

import fsp from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { resolveWithin } from './files';
import {
  sanitizeEntryPath,
  UploadRejectedError,
  MAX_EXTRACTED_BYTES,
  MAX_FILE_COUNT,
  MAX_SINGLE_ENTRY_BYTES,
} from './uploads';

export interface ExtractResult {
  fileCount: number;
  extractedBytes: number;
  files: string[]; // relative POSIX paths actually written
}

/* ─────────────────────────── TAR ─────────────────────────── */

const TAR_BLOCK = 512;

function readOctal(buf: Buffer, offset: number, length: number): number {
  // Tar numeric fields are octal ASCII, possibly space/NUL padded.
  let s = '';
  for (let i = offset; i < offset + length; i++) {
    const c = buf[i];
    if (c === 0 || c === 0x20) {
      if (s.length > 0) break;
      continue;
    }
    s += String.fromCharCode(c);
  }
  s = s.trim();
  if (!s) return 0;
  const n = parseInt(s, 8);
  return Number.isNaN(n) ? 0 : n;
}

function readString(buf: Buffer, offset: number, length: number): string {
  let end = offset;
  const max = offset + length;
  while (end < max && buf[end] !== 0) end++;
  return buf.slice(offset, end).toString('utf8');
}

interface TarEntry {
  name: string;
  size: number;
  typeflag: string;
  data: Buffer;
  linkname: string;
}

function parseTar(buf: Buffer): TarEntry[] {
  const entries: TarEntry[] = [];
  let offset = 0;
  let longName: string | null = null;

  while (offset + TAR_BLOCK <= buf.length) {
    const header = buf.slice(offset, offset + TAR_BLOCK);
    // Two consecutive zero blocks mark end-of-archive.
    if (header.every((b) => b === 0)) break;

    const name = readString(header, 0, 100);
    const size = readOctal(header, 124, 12);
    const typeflag = String.fromCharCode(header[156] || 0x30);
    const linkname = readString(header, 157, 100);
    const prefix = readString(header, 345, 155);

    offset += TAR_BLOCK;
    const dataSize = size;
    const data = buf.slice(offset, offset + dataSize);
    // Advance past data, rounded up to block size.
    offset += Math.ceil(dataSize / TAR_BLOCK) * TAR_BLOCK;

    // GNU long name extension
    if (typeflag === 'L') {
      longName = data.toString('utf8').replace(/\0+$/, '');
      continue;
    }

    const fullName = longName || (prefix ? `${prefix}/${name}` : name);
    longName = null;

    entries.push({ name: fullName, size: dataSize, typeflag, data, linkname });
  }
  return entries;
}

/* ─────────────────────────── ZIP ─────────────────────────── */

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
  externalAttrs: number;
  versionMadeBy: number;
}

function parseZipCentralDirectory(buf: Buffer): ZipEntry[] {
  // Find End Of Central Directory record (signature 0x06054b50), scanning backward.
  const EOCD_SIG = 0x06054b50;
  let eocd = -1;
  const minEocd = 22;
  for (let i = buf.length - minEocd; i >= 0; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) { eocd = i; break; }
  }
  if (eocd === -1) throw new UploadRejectedError('Invalid zip: no end-of-central-directory record');

  const entryCount = buf.readUInt16LE(eocd + 10);
  let cdOffset = buf.readUInt32LE(eocd + 16);

  const entries: ZipEntry[] = [];
  const CD_SIG = 0x02014b50;
  for (let i = 0; i < entryCount; i++) {
    if (cdOffset + 46 > buf.length || buf.readUInt32LE(cdOffset) !== CD_SIG) {
      throw new UploadRejectedError('Invalid zip: malformed central directory');
    }
    const versionMadeBy = buf.readUInt16LE(cdOffset + 4);
    const method = buf.readUInt16LE(cdOffset + 10);
    const compressedSize = buf.readUInt32LE(cdOffset + 20);
    const uncompressedSize = buf.readUInt32LE(cdOffset + 24);
    const nameLen = buf.readUInt16LE(cdOffset + 28);
    const extraLen = buf.readUInt16LE(cdOffset + 30);
    const commentLen = buf.readUInt16LE(cdOffset + 32);
    const externalAttrs = buf.readUInt32LE(cdOffset + 38);
    const localHeaderOffset = buf.readUInt32LE(cdOffset + 42);
    const name = buf.slice(cdOffset + 46, cdOffset + 46 + nameLen).toString('utf8');

    entries.push({
      name, method, compressedSize, uncompressedSize,
      localHeaderOffset, externalAttrs, versionMadeBy,
    });
    cdOffset += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function readZipEntryData(buf: Buffer, entry: ZipEntry): Buffer {
  const LOCAL_SIG = 0x04034b50;
  const off = entry.localHeaderOffset;
  if (off + 30 > buf.length || buf.readUInt32LE(off) !== LOCAL_SIG) {
    throw new UploadRejectedError(`Invalid zip: bad local header for ${entry.name}`);
  }
  const nameLen = buf.readUInt16LE(off + 26);
  const extraLen = buf.readUInt16LE(off + 28);
  const dataStart = off + 30 + nameLen + extraLen;
  const raw = buf.slice(dataStart, dataStart + entry.compressedSize);

  if (entry.method === 0) return raw; // stored
  if (entry.method === 8) {
    // Deflate with size limit to prevent zip-bomb memory exhaustion
    const MAX_INFLATE_OUTPUT = 100 * 1024 * 1024; // 100MB per entry
    return zlib.inflateRawSync(raw, { maxOutputLength: MAX_INFLATE_OUTPUT });
  }
  throw new UploadRejectedError(`Unsupported zip compression method ${entry.method} for ${entry.name}`);
}

/** True if a zip external attribute encodes a symlink (unix mode S_IFLNK). */
function zipIsSymlink(entry: ZipEntry): boolean {
  // Unix mode is in the high 16 bits of externalAttrs when versionMadeBy host is unix (3).
  const hostOs = entry.versionMadeBy >> 8;
  if (hostOs !== 3) return false;
  const unixMode = entry.externalAttrs >>> 16;
  const S_IFMT = 0o170000;
  const S_IFLNK = 0o120000;
  return (unixMode & S_IFMT) === S_IFLNK;
}

/* ─────────────────────── Shared write path ─────────────────────── */

async function writeEntry(
  destRoot: string,
  rawName: string,
  data: Buffer,
  state: { count: number; bytes: number; files: string[] },
): Promise<void> {
  const safeRel = sanitizeEntryPath(rawName);
  if (!safeRel || safeRel.endsWith('/')) return; // directory entry — created implicitly

  if (data.length > MAX_SINGLE_ENTRY_BYTES) {
    throw new UploadRejectedError(`Archive entry too large: ${rawName} (${data.length} bytes)`);
  }
  state.bytes += data.length;
  if (state.bytes > MAX_EXTRACTED_BYTES) {
    throw new UploadRejectedError(`Archive extraction exceeds max total size (${MAX_EXTRACTED_BYTES} bytes)`);
  }
  state.count += 1;
  if (state.count > MAX_FILE_COUNT) {
    throw new UploadRejectedError(`Archive exceeds max file count (${MAX_FILE_COUNT})`);
  }

  // Authoritative boundary enforcement: realpath-under-root check (same as FileTool).
  const abs = resolveWithin(destRoot, safeRel);
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  // Never follow/overwrite through a symlink: O_EXCL-ish — refuse if a symlink sits at the path.
  try {
    const lst = await fsp.lstat(abs);
    if (lst.isSymbolicLink()) {
      throw new UploadRejectedError(`Refusing to write through existing symlink: ${safeRel}`);
    }
  } catch (err: any) {
    if (err && err.code !== 'ENOENT') throw err;
  }
  await fsp.writeFile(abs, data, { flag: 'w' });
  state.files.push(safeRel);
}

/* ─────────────────────────── Public API ─────────────────────────── */

/**
 * Extract a supported archive buffer into destRoot (which must already be a
 * realpath-safe directory under the task workspace). Returns counts of what was
 * written. Throws UploadRejectedError on any unsafe entry — caller must treat a
 * throw as full rejection (no partial-success recovery).
 *
 * @param suffix one of '.tar', '.tar.gz', '.tgz', '.zip'
 */
export async function extractArchive(
  buf: Buffer,
  suffix: string,
  destRoot: string,
): Promise<ExtractResult> {
  await fsp.mkdir(destRoot, { recursive: true });
  const state = { count: 0, bytes: 0, files: [] as string[] };

  if (suffix === '.zip') {
    const entries = parseZipCentralDirectory(buf);
    for (const entry of entries) {
      if (entry.name.endsWith('/')) continue; // directory
      if (zipIsSymlink(entry)) {
        throw new UploadRejectedError(`Archive contains a symlink (rejected): ${entry.name}`);
      }
      const data = readZipEntryData(buf, entry);
      if (data.length !== entry.uncompressedSize && entry.uncompressedSize !== 0) {
        // size mismatch — corrupt or zip-bomb indicator
        throw new UploadRejectedError(`Zip entry size mismatch: ${entry.name}`);
      }
      await writeEntry(destRoot, entry.name, data, state);
    }
    return { fileCount: state.count, extractedBytes: state.bytes, files: state.files };
  }

  // tar family
  let tarBuf = buf;
  if (suffix === '.tar.gz' || suffix === '.tgz') {
    tarBuf = zlib.gunzipSync(buf);
  } else if (suffix !== '.tar') {
    throw new UploadRejectedError(`Unsupported archive type: ${suffix}`);
  }

  const entries = parseTar(tarBuf);
  for (const entry of entries) {
    const t = entry.typeflag;
    // Reject dangerous entry types outright.
    if (t === '2') throw new UploadRejectedError(`Archive contains a symlink (rejected): ${entry.name}`);
    if (t === '1') throw new UploadRejectedError(`Archive contains a hardlink (rejected): ${entry.name}`);
    if (t === '3' || t === '4') throw new UploadRejectedError(`Archive contains a device node (rejected): ${entry.name}`);
    if (t === '6') throw new UploadRejectedError(`Archive contains a FIFO (rejected): ${entry.name}`);
    if (t === '5') continue; // directory — created implicitly
    // Regular file: typeflag '0' or '\0' (old tar) or '7' (contiguous, treat as file)
    if (t !== '0' && t !== '\0' && t !== '7') {
      // Unknown/extension types (e.g. PAX 'x'/'g') — skip metadata, do not write.
      continue;
    }
    await writeEntry(destRoot, entry.name, entry.data, state);
  }
  return { fileCount: state.count, extractedBytes: state.bytes, files: state.files };
}
