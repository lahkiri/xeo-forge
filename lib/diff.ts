/**
 * Line diff — dependency-free, deterministic.
 *
 * WHY NO DEPENDENCY: this is consumed by `git_op diff`, by `file_edit` results
 * so every write the agent makes is inspectable rather than asserted, and by the
 * Files-changed rail in Work. All three are on the trust path — the whole point
 * is letting a user verify what actually changed — so the code doing the
 * comparison should be readable in this repo, not pulled from a transitive tree.
 *
 * DETERMINISM: the algorithm is a plain Myers-style LCS over lines with no
 * heuristics, no time budget, and no randomness. The same pair of inputs always
 * produces byte-identical output, which is what makes the unified-diff form
 * safe to show as evidence and safe to assert on in tests.
 *
 * The LCS table is O(n*m) in memory. `MAX_LCS_CELLS` caps that; past the cap the
 * diff degrades to a whole-file replace block rather than allocating gigabytes.
 * The degradation is reported in the result (`truncated`) so a caller never
 * silently presents a coarse diff as a precise one.
 */

/** One line of a diff. `normal` lines appear in both sides. */
export type DiffOp = 'add' | 'del' | 'normal';

export interface DiffLine {
  op: DiffOp;
  /** 1-based line number in the OLD file; undefined for added lines. */
  oldLine?: number;
  /** 1-based line number in the NEW file; undefined for deleted lines. */
  newLine?: number;
  text: string;
  /**
   * This line is the final line of a side whose file does NOT end in a newline,
   * so `\ No newline at end of file` belongs immediately after it.
   *
   * A `normal` line can carry this when BOTH files lack a trailing newline and
   * their last line is otherwise identical — git emits a single marker there,
   * not one per side, which is why this is one flag rather than two.
   */
  noEol?: boolean;
}

export interface DiffHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: DiffLine[];
}

export interface FileDiff {
  oldPath: string;
  newPath: string;
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
  /** True when the inputs were identical — callers render "no changes". */
  unchanged: boolean;
  /**
   * True when the input exceeded MAX_LCS_CELLS and the diff was degraded to a
   * single replace hunk. The UI must say so rather than implying line precision.
   */
  truncated: boolean;
  /** True when either side looks binary; no line diff is attempted. */
  binary: boolean;
  /** The OLD side did not end with a newline. */
  oldNoEol: boolean;
  /** The NEW side did not end with a newline. */
  newNoEol: boolean;
}

/**
 * 4 million cells. At ~8 bytes per Int32 entry plus row overhead this stays
 * comfortably inside a normal Node heap, and covers e.g. 2000x2000 lines —
 * larger than any file a human reviews line-by-line.
 */
const MAX_LCS_CELLS = 4_000_000;

/** Lines of surrounding context in each hunk, matching `git diff` default. */
export const DEFAULT_CONTEXT = 3;

/**
 * Split into lines WITHOUT losing information about the trailing newline.
 *
 * `'a\n'.split('\n')` is `['a','']` and `'a'.split('\n')` is `['a']`. Naively
 * dropping the empty tail makes those two files identical, which would hide a
 * real change — a missing final newline is a genuine diff that git reports.
 * So the empty tail is dropped only when it came from a trailing newline, and
 * the distinction is preserved by `noEol` below.
 *
 * `noEol` is not decoration: `applyNoEol` consumes it to turn an EOL-only change
 * into a real del/add pair and to place the `\ No newline at end of file` marker.
 * Returning the flag and ignoring it — which this module used to do — reports
 * `unchanged: true` for `'a\n'` vs `'a'`, which is a silent wrong answer on the
 * trust path.
 */
function splitLines(text: string): { lines: string[]; noEol: boolean } {
  if (text === '') return { lines: [], noEol: false };
  const normalized = text.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  if (lines[lines.length - 1] === '') {
    lines.pop();
    return { lines, noEol: false };
  }
  return { lines, noEol: true };
}

/**
 * A NUL byte in the first 8000 bytes is the same signal git uses. Cheap, and
 * wrong only for pathological text files that embed NUL.
 */
function looksBinary(text: string): boolean {
  const probe = text.length > 8000 ? text.slice(0, 8000) : text;
  return probe.includes('\0');
}

/**
 * Longest common subsequence over lines, returned as the diff script.
 *
 * Classic dynamic-programming LCS. Rows are Int32Array so the table is one
 * contiguous allocation per row rather than a JS array of numbers.
 */
function lcsDiff(a: string[], b: string[]): DiffLine[] {
  const n = a.length;
  const m = b.length;

  // Trim the common prefix and suffix first. Real edits touch a few lines in a
  // large file, so this usually collapses the DP problem to almost nothing and
  // is what keeps the cell cap from ever being hit in practice.
  let prefix = 0;
  while (prefix < n && prefix < m && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (suffix < n - prefix && suffix < m - prefix && a[n - 1 - suffix] === b[m - 1 - suffix]) suffix++;

  const midA = a.slice(prefix, n - suffix);
  const midB = b.slice(prefix, m - suffix);

  const out: DiffLine[] = [];
  for (let i = 0; i < prefix; i++) {
    out.push({ op: 'normal', oldLine: i + 1, newLine: i + 1, text: a[i] });
  }

  const rows = midA.length;
  const cols = midB.length;

  if (rows === 0 || cols === 0) {
    // Pure insertion or pure deletion in the middle: no table needed.
    for (let i = 0; i < rows; i++) {
      out.push({ op: 'del', oldLine: prefix + i + 1, text: midA[i] });
    }
    for (let j = 0; j < cols; j++) {
      out.push({ op: 'add', newLine: prefix + j + 1, text: midB[j] });
    }
  } else {
    const table: Int32Array[] = [];
    for (let i = 0; i <= rows; i++) table.push(new Int32Array(cols + 1));
    for (let i = rows - 1; i >= 0; i--) {
      const cur = table[i];
      const next = table[i + 1];
      for (let j = cols - 1; j >= 0; j--) {
        cur[j] = midA[i] === midB[j] ? next[j + 1] + 1 : Math.max(next[j], cur[j + 1]);
      }
    }
    // Walk the table forward. On a tie, deletions are emitted before additions
    // so output ordering is stable and matches git's presentation.
    let i = 0;
    let j = 0;
    while (i < rows && j < cols) {
      if (midA[i] === midB[j]) {
        out.push({ op: 'normal', oldLine: prefix + i + 1, newLine: prefix + j + 1, text: midA[i] });
        i++;
        j++;
      } else if (table[i + 1][j] >= table[i][j + 1]) {
        out.push({ op: 'del', oldLine: prefix + i + 1, text: midA[i] });
        i++;
      } else {
        out.push({ op: 'add', newLine: prefix + j + 1, text: midB[j] });
        j++;
      }
    }
    while (i < rows) {
      out.push({ op: 'del', oldLine: prefix + i + 1, text: midA[i] });
      i++;
    }
    while (j < cols) {
      out.push({ op: 'add', newLine: prefix + j + 1, text: midB[j] });
      j++;
    }
  }

  for (let k = 0; k < suffix; k++) {
    const oldIdx = n - suffix + k;
    const newIdx = m - suffix + k;
    out.push({ op: 'normal', oldLine: oldIdx + 1, newLine: newIdx + 1, text: a[oldIdx] });
  }

  return out;
}

/**
 * Mark the lines that need `\ No newline at end of file`, and — when only the
 * trailing newline differs — turn the last common line into a del/add pair.
 *
 * WHY THE SPLIT IS NEEDED: `lcsDiff` compares line CONTENT. `'a\n'` and `'a'`
 * both yield `['a']`, so the LCS is the whole file and the script is one
 * `normal` line. But the files are not identical, and git shows the change as
 * `-a` / `+a` with the marker on one side. Without this step the module reports
 * `unchanged: true` and the diff is a lie.
 *
 * WHEN BOTH SIDES LACK THE NEWLINE the final `normal` line stays normal and
 * carries a single `noEol` — one marker, matching git, because neither side has
 * the terminator so there is nothing to contrast.
 */
function applyNoEol(script: DiffLine[], oldNoEol: boolean, newNoEol: boolean): DiffLine[] {
  if (!oldNoEol && !newNoEol) return script;

  const lastOld = findLastIndex(script, (l) => l.oldLine !== undefined);
  const lastNew = findLastIndex(script, (l) => l.newLine !== undefined);

  // Both sides unterminated and the final line is shared: one marker, no split.
  if (oldNoEol && newNoEol && lastOld === lastNew && lastOld !== -1 && script[lastOld].op === 'normal') {
    const out = script.slice();
    out[lastOld] = { ...out[lastOld], noEol: true };
    return out;
  }

  // Exactly one side is unterminated and the final line is shared, so the ONLY
  // difference is the terminator. Split it so the change is visible at all.
  if (oldNoEol !== newNoEol && lastOld === lastNew && lastOld !== -1 && script[lastOld].op === 'normal') {
    const line = script[lastOld];
    const del: DiffLine = { op: 'del', oldLine: line.oldLine, text: line.text, ...(oldNoEol ? { noEol: true } : {}) };
    const add: DiffLine = { op: 'add', newLine: line.newLine, text: line.text, ...(newNoEol ? { noEol: true } : {}) };
    return [...script.slice(0, lastOld), del, add, ...script.slice(lastOld + 1)];
  }

  // Otherwise the sides already differ at the end; just flag the last line of
  // each unterminated side.
  const out = script.slice();
  if (oldNoEol && lastOld !== -1) out[lastOld] = { ...out[lastOld], noEol: true };
  if (newNoEol && lastNew !== -1) out[lastNew] = { ...out[lastNew], noEol: true };
  return out;
}

/** `Array.prototype.findLastIndex` without requiring a newer lib target. */
function findLastIndex<T>(items: T[], predicate: (item: T) => boolean): number {
  for (let i = items.length - 1; i >= 0; i--) {
    if (predicate(items[i])) return i;
  }
  return -1;
}

/** Group a flat diff script into hunks with `context` lines around each change. */
export function groupHunks(script: DiffLine[], context = DEFAULT_CONTEXT): DiffHunk[] {
  const changed: number[] = [];
  for (let i = 0; i < script.length; i++) {
    if (script[i].op !== 'normal') changed.push(i);
  }
  if (changed.length === 0) return [];

  // Merge change indices into ranges that are within 2*context of each other,
  // so two nearby edits share one hunk instead of producing adjacent hunks with
  // overlapping context (which would print the same lines twice).
  const ranges: Array<[number, number]> = [];
  let start = Math.max(0, changed[0] - context);
  let end = Math.min(script.length - 1, changed[0] + context);
  for (let k = 1; k < changed.length; k++) {
    const lo = Math.max(0, changed[k] - context);
    const hi = Math.min(script.length - 1, changed[k] + context);
    if (lo <= end + 1) {
      end = Math.max(end, hi);
    } else {
      ranges.push([start, end]);
      start = lo;
      end = hi;
    }
  }
  ranges.push([start, end]);

  return ranges.map(([lo, hi]) => {
    const lines = script.slice(lo, hi + 1);
    let oldStart = 0;
    let newStart = 0;
    let oldCount = 0;
    let newCount = 0;
    for (const line of lines) {
      if (line.oldLine !== undefined) {
        if (oldStart === 0) oldStart = line.oldLine;
        oldCount++;
      }
      if (line.newLine !== undefined) {
        if (newStart === 0) newStart = line.newLine;
        newCount++;
      }
    }
    // A hunk that is pure insertion has no old lines. Unified format expresses
    // that as a zero count anchored at the preceding old line.
    if (oldStart === 0) {
      const before = script.slice(0, lo).filter((l) => l.oldLine !== undefined).pop();
      oldStart = before?.oldLine ?? 0;
    }
    if (newStart === 0) {
      const before = script.slice(0, lo).filter((l) => l.newLine !== undefined).pop();
      newStart = before?.newLine ?? 0;
    }
    return { oldStart, oldCount, newStart, newCount, lines };
  });
}

export interface DiffOptions {
  oldPath?: string;
  newPath?: string;
  context?: number;
}

/** Compute a structured diff between two text blobs. */
export function diffText(oldText: string, newText: string, options: DiffOptions = {}): FileDiff {
  const oldPath = options.oldPath ?? 'a';
  const newPath = options.newPath ?? 'b';
  const context = options.context ?? DEFAULT_CONTEXT;

  const base: FileDiff = {
    oldPath,
    newPath,
    hunks: [],
    additions: 0,
    deletions: 0,
    unchanged: false,
    truncated: false,
    binary: false,
    oldNoEol: false,
    newNoEol: false,
  };

  if (looksBinary(oldText) || looksBinary(newText)) {
    return { ...base, binary: true, unchanged: oldText === newText };
  }
  if (oldText === newText) {
    return { ...base, unchanged: true };
  }

  const a = splitLines(oldText);
  const b = splitLines(newText);

  let script: DiffLine[];
  let truncated = false;
  if (a.lines.length * b.lines.length > MAX_LCS_CELLS) {
    // Too large for a precise diff. Degrade honestly: one replace block, and the
    // `truncated` flag so the UI says so rather than implying line precision.
    truncated = true;
    script = [
      ...a.lines.map((text, i): DiffLine => ({ op: 'del', oldLine: i + 1, text })),
      ...b.lines.map((text, i): DiffLine => ({ op: 'add', newLine: i + 1, text })),
    ];
  } else {
    script = lcsDiff(a.lines, b.lines);
  }

  // Must run BEFORE the counts: for an EOL-only change this is what produces the
  // del/add pair, so counting first would report 0/0 and then `unchanged: true`.
  script = applyNoEol(script, a.noEol, b.noEol);

  const additions = script.filter((l) => l.op === 'add').length;
  const deletions = script.filter((l) => l.op === 'del').length;

  return {
    oldPath,
    newPath,
    hunks: groupHunks(script, context),
    additions,
    deletions,
    unchanged: additions === 0 && deletions === 0,
    truncated,
    binary: false,
    oldNoEol: a.noEol,
    newNoEol: b.noEol,
  };
}

/**
 * Render a `FileDiff` as unified diff text.
 *
 * Output is byte-comparable with `git diff --no-color` for ordinary cases, which
 * is what lets the same renderer display both a computed diff and git's own.
 */
export function toUnifiedDiff(diff: FileDiff): string {
  if (diff.binary) return `--- ${diff.oldPath}\n+++ ${diff.newPath}\nBinary files differ\n`;
  if (diff.unchanged) return '';

  const out: string[] = [`--- ${diff.oldPath}`, `+++ ${diff.newPath}`];
  for (const hunk of diff.hunks) {
    out.push(`@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`);
    for (const line of hunk.lines) {
      const prefix = line.op === 'add' ? '+' : line.op === 'del' ? '-' : ' ';
      out.push(prefix + line.text);
      // git's exact spelling. It follows the line it describes, and it is NOT
      // prefixed with an op character, which is why the parser has to skip it
      // rather than read it as content.
      if (line.noEol) out.push('\\ No newline at end of file');
    }
  }
  return out.join('\n') + '\n';
}

/** Convenience: structured diff straight to unified text. */
export function unifiedDiff(oldText: string, newText: string, options: DiffOptions = {}): string {
  return toUnifiedDiff(diffText(oldText, newText, options));
}

export interface ParsedFileDiff {
  oldPath: string;
  newPath: string;
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
  binary: boolean;
  /** A `\ No newline at end of file` marker applied to the OLD side. */
  oldNoEol: boolean;
  /** A `\ No newline at end of file` marker applied to the NEW side. */
  newNoEol: boolean;
}

/**
 * Parse unified diff text (as produced by `git diff`) into the same structure
 * `diffText` returns, so ONE renderer handles both sources.
 *
 * UNTRUSTED INPUT: this parses output from an external `git` process. It never
 * evaluates anything, never resolves a path, and skips lines it does not
 * recognise instead of throwing — a malformed or hostile diff yields a partial
 * render, not an exception in a React tree.
 */
export function parseUnifiedDiff(text: string): ParsedFileDiff[] {
  const files: ParsedFileDiff[] = [];
  let current: ParsedFileDiff | null = null;
  let hunk: DiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;

  const blank = (binary = false): ParsedFileDiff => ({
    oldPath: '',
    newPath: '',
    hunks: [],
    additions: 0,
    deletions: 0,
    binary,
    oldNoEol: false,
    newNoEol: false,
  });

  const closeHunk = () => {
    if (current && hunk) current.hunks.push(hunk);
    hunk = null;
  };

  for (const raw of text.split('\n')) {
    if (raw.startsWith('diff --git')) {
      closeHunk();
      // Paths are re-read from the ---/+++ lines below; this only starts a file.
      current = blank();
      files.push(current);
      continue;
    }
    if (raw.startsWith('Binary files') || raw.startsWith('GIT binary patch')) {
      if (!current) {
        current = blank(true);
        files.push(current);
      } else {
        current.binary = true;
      }
      closeHunk();
      continue;
    }
    if (raw.startsWith('--- ')) {
      closeHunk();
      if (!current) {
        current = blank();
        files.push(current);
      }
      current.oldPath = raw.slice(4).replace(/^a\//, '');
      continue;
    }
    if (raw.startsWith('+++ ')) {
      if (current) current.newPath = raw.slice(4).replace(/^b\//, '');
      continue;
    }
    const header = raw.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (header) {
      closeHunk();
      if (!current) {
        current = blank();
        files.push(current);
      }
      oldLine = Number(header[1]);
      newLine = Number(header[3]);
      hunk = {
        oldStart: oldLine,
        oldCount: header[2] === undefined ? 1 : Number(header[2]),
        newStart: newLine,
        newCount: header[4] === undefined ? 1 : Number(header[4]),
        lines: [],
      };
      continue;
    }
    // The marker describes the PRECEDING line and carries no op prefix. It is
    // attached to that line rather than dropped, so a round trip through
    // parse → render preserves it; the body itself is left untouched, which is
    // what the existing "drops the marker without disturbing the body" contract
    // requires.
    if (raw.startsWith('\\ No newline')) {
      if (hunk && current) {
        const last = hunk.lines[hunk.lines.length - 1];
        if (last) {
          last.noEol = true;
          if (last.op !== 'add') current.oldNoEol = true;
          if (last.op !== 'del') current.newNoEol = true;
        }
      }
      continue;
    }
    if (!hunk || !current) continue;
    if (raw.startsWith('+')) {
      hunk.lines.push({ op: 'add', newLine: newLine++, text: raw.slice(1) });
      current.additions++;
    } else if (raw.startsWith('-')) {
      hunk.lines.push({ op: 'del', oldLine: oldLine++, text: raw.slice(1) });
      current.deletions++;
    } else if (raw.startsWith(' ')) {
      hunk.lines.push({ op: 'normal', oldLine: oldLine++, newLine: newLine++, text: raw.slice(1) });
    }
    // Anything else — mode lines, index lines, "similarity index", stray text —
    // is skipped deliberately. The marker is handled above, not here.
  }
  closeHunk();
  return files.filter((f) => f.hunks.length > 0 || f.binary);
}
