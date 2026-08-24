import { describe, it, expect } from 'vitest';
import {
  DEFAULT_CONTEXT,
  diffText,
  groupHunks,
  parseUnifiedDiff,
  toUnifiedDiff,
  unifiedDiff,
  type DiffHunk,
  type DiffLine,
  type FileDiff,
} from '../lib/diff';

/* ------------------------------------------------------------------ */
/* Adversarial tests for lib/diff.ts — the module behind `git_op diff`,*/
/* `file_edit` result rendering and the Files-changed rail. Every      */
/* assertion here pins observed behaviour of the real module: the      */
/* output is shown to users as evidence, so header arithmetic, line    */
/* numbering and ordering are contracts, not implementation details.   */
/* ------------------------------------------------------------------ */

/** Build "1\n2\n...\nN\n" — a normal text file with a trailing newline. */
function lines(n: number, map: (i: number) => string = (i) => `L${i + 1}`): string {
  return Array.from({ length: n }, (_, i) => map(i)).join('\n') + '\n';
}

/** Replace one 0-based line of a newline-terminated blob. */
function replaceLine(text: string, index: number, next: string): string {
  const parts = text.split('\n');
  parts[index] = next;
  return parts.join('\n');
}

/** Compact "op+text" view of a hunk, for ordering assertions. */
function shape(hunk: DiffHunk): string[] {
  return hunk.lines.map((l) => (l.op === 'add' ? '+' : l.op === 'del' ? '-' : ' ') + l.text);
}

/** A synthetic flat script: normals everywhere except `changes` indices. */
function script(length: number, changes: Array<[number, 'add' | 'del']>): DiffLine[] {
  const at = new Map(changes);
  const out: DiffLine[] = [];
  let oldNo = 1;
  let newNo = 1;
  for (let i = 0; i < length; i++) {
    const op = at.get(i);
    if (op === 'del') out.push({ op: 'del', oldLine: oldNo++, text: `x${i}` });
    else if (op === 'add') out.push({ op: 'add', newLine: newNo++, text: `x${i}` });
    else out.push({ op: 'normal', oldLine: oldNo++, newLine: newNo++, text: `x${i}` });
  }
  return out;
}

/** Header counts must equal the number of lines actually carrying a side. */
function assertHunkCountsConsistent(diff: FileDiff | { hunks: DiffHunk[] }) {
  for (const h of diff.hunks) {
    expect(h.oldCount).toBe(h.lines.filter((l) => l.oldLine !== undefined).length);
    expect(h.newCount).toBe(h.lines.filter((l) => l.newLine !== undefined).length);
  }
}

describe('LCS minimality', () => {
  it('deletes one line instead of rewriting the whole file', () => {
    const d = diffText('a\nb\nc\n', 'b\nc\n');
    expect([d.deletions, d.additions]).toEqual([1, 0]);
    expect(shape(d.hunks[0])).toEqual(['-a', ' b', ' c']);
  });

  it('finds the single moved line in a transposition (1 del + 1 add, not 3)', () => {
    const d = diffText('a\nb\nc\nd\n', 'a\nc\nb\nd\n');
    expect([d.deletions, d.additions]).toEqual([1, 1]);
    expect(shape(d.hunks[0])).toEqual([' a', '-b', ' c', '+b', ' d']);
  });

  it('reuses the common run when a block is rotated (naive compare would change all 5)', () => {
    const d = diffText('1\n2\n3\n4\n5\n', '3\n4\n5\n1\n2\n');
    // Naive positional comparison changes every line; LCS keeps 3/4/5.
    expect([d.deletions, d.additions]).toEqual([2, 2]);
    expect(shape(d.hunks[0])).toEqual(['-1', '-2', ' 3', ' 4', ' 5', '+1', '+2']);
  });

  it('removes only the interleaved lines rather than re-adding the survivors', () => {
    const d = diffText('a\n1\nb\n2\nc\n', 'a\nb\nc\n');
    expect([d.deletions, d.additions]).toEqual([2, 0]);
    expect(shape(d.hunks[0])).toEqual([' a', '-1', ' b', '-2', ' c']);
  });

  it('handles duplicate lines without inventing extra edits', () => {
    const grow = diffText('x\nx\nx\n', 'x\nx\nx\nx\n');
    expect([grow.deletions, grow.additions]).toEqual([0, 1]);
    const shrink = diffText('x\nx\nx\nx\n', 'x\nx\nx\n');
    expect([shrink.deletions, shrink.additions]).toEqual([1, 0]);
  });

  it('reports a pure append as additions only', () => {
    const d = diffText(lines(5), lines(5) + 'L6\nL7\n');
    expect([d.deletions, d.additions]).toEqual([0, 2]);
  });

  it('reports a pure prepend as additions only', () => {
    const d = diffText(lines(5), 'L0\n' + lines(5));
    expect([d.deletions, d.additions]).toEqual([0, 1]);
  });
});

describe('line numbering after misalignment', () => {
  const oldText = lines(20);
  const newText = 'X\n' + replaceLine(lines(20), 17, 'L18-mod');

  it('keeps old and new numbers independent once the sides are offset by one', () => {
    const d = diffText(oldText, newText);
    expect(d.hunks).toHaveLength(2);

    const top = d.hunks[0];
    expect(top.lines[0]).toEqual({ op: 'add', newLine: 1, text: 'X' });
    // The context after the insertion is old 1..3 but new 2..4.
    expect(top.lines.slice(1).map((l) => [l.text, l.oldLine, l.newLine])).toEqual([
      ['L1', 1, 2],
      ['L2', 2, 3],
      ['L3', 3, 4],
    ]);

    const bottom = d.hunks[1];
    const del = bottom.lines.find((l) => l.op === 'del')!;
    const add = bottom.lines.find((l) => l.op === 'add')!;
    expect(del).toEqual({ op: 'del', oldLine: 18, text: 'L18' });
    expect(add).toEqual({ op: 'add', newLine: 19, text: 'L18-mod' });
    // Trailing context stays one apart in the same direction.
    expect(bottom.lines.slice(-2).map((l) => [l.text, l.oldLine, l.newLine])).toEqual([
      ['L19', 19, 20],
      ['L20', 20, 21],
    ]);
  });

  it('emits headers whose start lines reflect the offset', () => {
    expect(unifiedDiff(oldText, newText)).toBe(
      [
        '--- a',
        '+++ b',
        '@@ -1,3 +1,4 @@',
        '+X',
        ' L1',
        ' L2',
        ' L3',
        '@@ -15,6 +16,6 @@',
        ' L15',
        ' L16',
        ' L17',
        '-L18',
        '+L18-mod',
        ' L19',
        ' L20',
        '',
      ].join('\n'),
    );
  });

  it('never lets a new-side number lag the old side after an insertion', () => {
    const d = diffText(oldText, newText);
    for (const h of d.hunks) {
      for (const l of h.lines) {
        if (l.op === 'normal') expect(l.newLine).toBe(l.oldLine! + 1);
      }
    }
  });

  it('numbers every line monotonically within a hunk', () => {
    const d = diffText(lines(30), replaceLine(replaceLine(lines(30), 2, 'A'), 25, 'B'));
    for (const h of d.hunks) {
      let lastOld = 0;
      let lastNew = 0;
      for (const l of h.lines) {
        if (l.oldLine !== undefined) {
          expect(l.oldLine).toBeGreaterThan(lastOld);
          lastOld = l.oldLine;
        }
        if (l.newLine !== undefined) {
          expect(l.newLine).toBeGreaterThan(lastNew);
          lastNew = l.newLine;
        }
      }
    }
  });

  it('gives added lines no oldLine and deleted lines no newLine', () => {
    const d = diffText(lines(10), replaceLine(lines(10), 4, 'CHANGED'));
    for (const l of d.hunks.flatMap((h) => h.lines)) {
      if (l.op === 'add') expect(l.oldLine).toBeUndefined();
      if (l.op === 'del') expect(l.newLine).toBeUndefined();
      if (l.op === 'normal') {
        expect(l.oldLine).toBeDefined();
        expect(l.newLine).toBeDefined();
      }
    }
  });

  it('anchors the header at the first line of context, not the change', () => {
    // Change at old line 10 with 3 lines of context starts the hunk at 7.
    expect(unifiedDiff(lines(20), replaceLine(lines(20), 9, 'TEN'))).toContain('@@ -7,7 +7,7 @@');
  });
});

describe('newline and line-splitting semantics', () => {
  it('treats "" vs "\\n" as a single added empty line', () => {
    const d = diffText('', '\n');
    expect([d.additions, d.deletions]).toEqual([1, 0]);
    expect(d.hunks[0].lines).toEqual([{ op: 'add', newLine: 1, text: '' }]);
    expect(unifiedDiff('', '\n')).toBe('--- a\n+++ b\n@@ -0,0 +1,1 @@\n+\n');
  });

  it('emits "\\ No newline at end of file" only for an unterminated side', () => {
    // Replaces an earlier assertion that the marker was NEVER emitted. That
    // pinned the defect: `splitLines` computed `noEol` and `diffText` discarded
    // it, so a missing final newline — a change git reports — was invisible.
    // git's own output for these three cases is the contract being matched.
    const bothUnterminated = unifiedDiff('a\nb', 'a\nc');
    expect(bothUnterminated).toBe(
      '--- a\n+++ b\n@@ -1,2 +1,2 @@\n a\n-b\n\\ No newline at end of file\n+c\n\\ No newline at end of file\n',
    );

    // Old terminated, new not: only the added line carries the marker.
    const newOnly = unifiedDiff('a\nb\n', 'a\nc');
    expect(newOnly).toBe('--- a\n+++ b\n@@ -1,2 +1,2 @@\n a\n-b\n+c\n\\ No newline at end of file\n');

    // Both terminated: no marker anywhere.
    expect(unifiedDiff('a\nb\n', 'a\nc\n')).not.toContain('\\ No newline');
  });

  it('reports an EOL-only change instead of calling it unchanged', () => {
    // THE REGRESSION THIS GUARDS: the module used to return `unchanged: true`
    // here, because lcsDiff compares line CONTENT and both sides split to ['a'].
    // git shows `-a` / `+a` with the marker on the unterminated side.
    const d = diffText('a\n', 'a');
    expect(d.unchanged).toBe(false);
    expect([d.additions, d.deletions]).toEqual([1, 1]);
    expect([d.oldNoEol, d.newNoEol]).toEqual([false, true]);
    expect(unifiedDiff('a\n', 'a')).toBe(
      '--- a\n+++ b\n@@ -1,1 +1,1 @@\n-a\n+a\n\\ No newline at end of file\n',
    );
  });

  it('reports adding a trailing newline as a change too', () => {
    // The mirror direction: the marker moves to the OLD side.
    const d = diffText('a', 'a\n');
    expect(d.unchanged).toBe(false);
    expect([d.oldNoEol, d.newNoEol]).toEqual([true, false]);
    expect(unifiedDiff('a', 'a\n')).toBe(
      '--- a\n+++ b\n@@ -1,1 +1,1 @@\n-a\n\\ No newline at end of file\n+a\n',
    );
  });

  it('emits a single marker when both sides are unterminated and identical at the end', () => {
    // `x` is the shared unterminated last line, so there is nothing to contrast:
    // git prints one marker on the context line, not one per side.
    const text = unifiedDiff('a\nx', 'b\nx');
    expect(text).toBe('--- a\n+++ b\n@@ -1,2 +1,2 @@\n-a\n+b\n x\n\\ No newline at end of file\n');
    expect(text.match(/\\ No newline/g)).toHaveLength(1);
  });

  it('does not split an EOL-only change when the last lines already differ', () => {
    // Here the tail differs on content as well, so the del/add pair already
    // exists and no synthetic split is needed — just the marker.
    const d = diffText('a\nb\n', 'a\nc');
    expect([d.additions, d.deletions]).toEqual([1, 1]);
    expect(shape(d.hunks[0])).toEqual([' a', '-b', '+c']);
  });

  it('flags noEol on the exact line the marker belongs to', () => {
    const d = diffText('a\n', 'a');
    const del = d.hunks[0].lines.find((l) => l.op === 'del')!;
    const add = d.hunks[0].lines.find((l) => l.op === 'add')!;
    expect(del.noEol).toBeUndefined();
    expect(add.noEol).toBe(true);
  });

  it('keeps every body line op-prefixed apart from the marker itself', () => {
    for (const [x, y] of [
      ['a\nb', 'a\nc'],
      ['a\nb\n', 'a\nc'],
      ['a', 'b'],
      ['a\n', 'a'],
    ]) {
      const text = unifiedDiff(x, y);
      for (const line of text.split('\n').slice(2).filter(Boolean)) {
        if (line.startsWith('\\ No newline')) continue;
        expect(['@', ' ', '+', '-']).toContain(line[0]);
      }
    }
  });

  it('round-trips the marker through parseUnifiedDiff', () => {
    const text = unifiedDiff('a\n', 'a');
    const parsed = parseUnifiedDiff(text);
    expect([parsed[0].oldNoEol, parsed[0].newNoEol]).toEqual([false, true]);
    const add = parsed[0].hunks[0].lines.find((l) => l.op === 'add')!;
    expect(add.noEol).toBe(true);
    // Re-rendering the parsed form reproduces the same bytes.
    expect(
      toUnifiedDiff({
        ...parsed[0],
        unchanged: false,
        truncated: false,
        oldPath: 'a',
        newPath: 'b',
      }),
    ).toBe(text);
  });

  it('diffs content normally when neither side ends with a newline', () => {
    const d = diffText('a\nb', 'a\nc');
    expect([d.additions, d.deletions]).toEqual([1, 1]);
    expect(shape(d.hunks[0])).toEqual([' a', '-b', '+c']);
  });

  it('compares the unterminated last line against a terminated one', () => {
    const d = diffText('a\nb', 'a\nB\n');
    expect(shape(d.hunks[0])).toEqual([' a', '-b', '+B']);
  });

  it('counts an empty file as zero lines, not one', () => {
    const d = diffText('', 'a\nb\n');
    expect(d.additions).toBe(2);
    expect(d.hunks[0].oldStart).toBe(0);
    expect(d.hunks[0].oldCount).toBe(0);
  });

  it('reports deleting a whole file as a zero-count new side', () => {
    expect(unifiedDiff('a\n', '')).toBe('--- a\n+++ b\n@@ -1,1 +0,0 @@\n-a\n');
  });

  it('preserves interior blank lines as real lines', () => {
    const d = diffText('\n\n\n', '\n\n');
    expect([d.additions, d.deletions]).toEqual([0, 1]);
    expect(d.hunks[0].lines.map((l) => l.text)).toEqual(['', '', '']);
  });

  it('treats trailing whitespace as a content change', () => {
    const d = diffText('a \n', 'a\n');
    expect(shape(d.hunks[0])).toEqual(['-a ', '+a']);
  });

  it('normalizes CRLF so line endings alone are not reported as a change', () => {
    const d = diffText('a\r\nb\r\n', 'a\nb\n');
    expect(d.unchanged).toBe(true);
    expect(d.hunks).toEqual([]);
  });

  it('diffs CRLF input on content, with \\r stripped from the emitted text', () => {
    const d = diffText('a\r\nb\r\n', 'a\r\nc\r\n');
    expect(shape(d.hunks[0])).toEqual([' a', '-b', '+c']);
  });

  it('keeps a lone \\r inside a line rather than splitting on it', () => {
    const d = diffText('a\rb\n', 'a\rc\n');
    expect(d.hunks[0].lines.map((l) => l.text)).toEqual(['a\rb', 'a\rc']);
    expect(d.hunks[0].oldCount).toBe(1);
  });

  it('reports identical inputs as unchanged with empty unified output', () => {
    const d = diffText(lines(5), lines(5));
    expect(d.unchanged).toBe(true);
    expect(d.hunks).toEqual([]);
    expect(toUnifiedDiff(d)).toBe('');
  });
});

describe('binary detection', () => {
  it('flags a NUL byte on either side and skips the line diff', () => {
    for (const [x, y] of [
      ['a\0b', 'x'],
      ['x', 'a\0b'],
    ]) {
      const d = diffText(x, y);
      expect(d.binary).toBe(true);
      expect(d.hunks).toEqual([]);
      expect([d.additions, d.deletions]).toEqual([0, 0]);
    }
  });

  it('renders a binary diff as a fixed three-line body', () => {
    expect(unifiedDiff('a\0b', 'x\0y', { oldPath: 'p', newPath: 'q' })).toBe(
      '--- p\n+++ q\nBinary files differ\n',
    );
  });

  it('marks identical binary inputs both binary and unchanged', () => {
    const d = diffText('a\0b', 'a\0b');
    expect(d.binary).toBe(true);
    expect(d.unchanged).toBe(true);
    // binary wins over unchanged in the renderer
    expect(toUnifiedDiff(d)).toBe('--- a\n+++ b\nBinary files differ\n');
  });

  it('only probes the first 8000 bytes, so a late NUL reads as text', () => {
    const late = 'x'.repeat(9000) + '\0';
    const d = diffText(late, 'y');
    expect(d.binary).toBe(false);
    expect(d.hunks[0].lines[0].text).toBe(late);
  });

  it('detects a NUL exactly inside the probe window', () => {
    expect(diffText('x'.repeat(7999) + '\0', 'y').binary).toBe(true);
  });

  it('does not treat other control characters or high unicode as binary', () => {
    expect(diffText('[31m\n', '\n').binary).toBe(false);
    expect(diffText('�\n', '￾\n').binary).toBe(false);
    expect(diffText('\n', '\n').binary).toBe(false);
  });
});

describe('hunk grouping and merging', () => {
  it('merges two changes separated by fewer than 2*context lines', () => {
    const base = lines(40, (i) => `x${i}`);
    const next = replaceLine(replaceLine(base, 10, 'A'), 16, 'B');
    const d = diffText(base, next);
    expect(d.hunks).toHaveLength(1);
    assertHunkCountsConsistent(d);
  });

  it('splits when the gap between changes exceeds 2*context', () => {
    const base = lines(40, (i) => `x${i}`);
    const next = replaceLine(replaceLine(base, 10, 'A'), 18, 'B');
    const d = diffText(base, next);
    expect(d.hunks).toHaveLength(2);
    // Changes at old lines 11 and 19, each with 3 lines of context.
    expect(d.hunks.map((h) => [h.oldStart, h.oldCount])).toEqual([
      [8, 7],
      [16, 7],
    ]);
  });

  it('finds the exact merge boundary at a gap of 2*context lines', () => {
    const base = lines(40, (i) => `x${i}`);
    const gapOf = (gap: number) => {
      const next = replaceLine(replaceLine(base, 10, 'A'), 11 + gap, 'B');
      return diffText(base, next).hunks.length;
    };
    // 6 untouched lines between the changes still merges (context windows touch);
    // 7 is the first gap that produces two hunks.
    expect(gapOf(5)).toBe(1);
    expect(gapOf(6)).toBe(1);
    expect(gapOf(7)).toBe(2);
    expect(gapOf(8)).toBe(2);
  });

  it('uses the documented default of 3 context lines', () => {
    expect(DEFAULT_CONTEXT).toBe(3);
    const d = diffText(lines(20), replaceLine(lines(20), 9, 'TEN'));
    const h = d.hunks[0];
    expect(h.lines.filter((l) => l.op === 'normal')).toHaveLength(6);
    expect(h.lines[0].oldLine).toBe(7);
  });

  it('honours an explicit context of 0 (change lines only)', () => {
    expect(unifiedDiff(lines(10, (i) => `${i}`), replaceLine(lines(10, (i) => `${i}`), 5, 'five'))).toContain(
      '@@ -3,7 +3,7 @@',
    );
    expect(unifiedDiff(lines(10, (i) => `${i}`), replaceLine(lines(10, (i) => `${i}`), 5, 'five'), { context: 0 })).toBe(
      '--- a\n+++ b\n@@ -6,1 +6,1 @@\n-5\n+five\n',
    );
  });

  it('honours an explicit context of 1', () => {
    expect(unifiedDiff(lines(10, (i) => `${i}`), replaceLine(lines(10, (i) => `${i}`), 5, 'five'), { context: 1 })).toBe(
      '--- a\n+++ b\n@@ -5,3 +5,3 @@\n 4\n-5\n+five\n 6\n',
    );
  });

  it('clamps context to the file, never producing out-of-range numbers', () => {
    const d = diffText('a\nb\nc\n', 'a\nZ\nc\n', { context: 1000 });
    expect(d.hunks).toHaveLength(1);
    expect(d.hunks[0].oldStart).toBe(1);
    expect(d.hunks[0].oldCount).toBe(3);
    expect(unifiedDiff('a\nb\nc\n', 'a\nZ\nc\n', { context: 1000 })).toBe(
      '--- a\n+++ b\n@@ -1,3 +1,3 @@\n a\n-b\n+Z\n c\n',
    );
  });

  it('returns no hunks for a script with no changes', () => {
    expect(groupHunks([])).toEqual([]);
    expect(groupHunks([{ op: 'normal', oldLine: 1, newLine: 1, text: 'a' }])).toEqual([]);
  });

  it('keeps three separate hunks for three well-separated changes', () => {
    const base = lines(60, (i) => `x${i}`);
    const next = replaceLine(replaceLine(replaceLine(base, 5, 'A'), 25, 'B'), 45, 'C');
    const d = diffText(base, next);
    expect(d.hunks).toHaveLength(3);
    assertHunkCountsConsistent(d);
    // Hunks are ordered and non-overlapping.
    for (let i = 1; i < d.hunks.length; i++) {
      expect(d.hunks[i].oldStart).toBeGreaterThan(d.hunks[i - 1].oldStart + d.hunks[i - 1].oldCount - 1);
    }
  });

  it('groups directly from a synthetic script with the same merge rule', () => {
    // The rule is index-based on the flat script: a new change merges while its
    // leading context starts no later than one past the current hunk's end.
    expect(groupHunks(script(40, [[10, 'del'], [18, 'del']]), 3)).toHaveLength(2);
    expect(groupHunks(script(40, [[10, 'del'], [17, 'del']]), 3)).toHaveLength(1);
  });
});

describe('unified diff header shape', () => {
  it('always writes explicit counts, including the ",1" git would omit', () => {
    // git prints "@@ -1 +1 @@" for single-line hunks; this implementation is explicit.
    expect(unifiedDiff('a\n', 'b\n')).toBe('--- a\n+++ b\n@@ -1,1 +1,1 @@\n-a\n+b\n');
  });

  it('uses a zero count anchored at 0 for a diff against an empty old file', () => {
    expect(unifiedDiff('', 'a\n')).toBe('--- a\n+++ b\n@@ -0,0 +1,1 @@\n+a\n');
  });

  it('emits the ---/+++ preamble with the supplied paths', () => {
    const text = unifiedDiff('a\n', 'b\n', { oldPath: 'a/src/x.ts', newPath: 'b/src/x.ts' });
    expect(text.split('\n').slice(0, 2)).toEqual(['--- a/src/x.ts', '+++ b/src/x.ts']);
  });

  it('defaults the paths to "a" and "b"', () => {
    const d = diffText('a\n', 'b\n');
    expect([d.oldPath, d.newPath]).toEqual(['a', 'b']);
  });

  it('terminates the output with exactly one trailing newline', () => {
    const text = unifiedDiff(lines(20), replaceLine(lines(20), 9, 'TEN'));
    expect(text.endsWith('\n')).toBe(true);
    expect(text.endsWith('\n\n')).toBe(false);
  });

  it('prefixes every body line with a single-character op marker', () => {
    const text = unifiedDiff(lines(10), replaceLine(lines(10), 4, 'CHANGED'));
    const body = text.split('\n').filter((l) => l && !l.startsWith('@@') && !l.startsWith('---') && !l.startsWith('+++'));
    expect(body.every((l) => [' ', '+', '-'].includes(l[0]))).toBe(true);
    expect(body).toContain('-L5');
    expect(body).toContain('+CHANGED');
  });

  it('matches header counts to the emitted body line counts', () => {
    const base = lines(30);
    const next = 'TOP\n' + replaceLine(base, 20, 'MID').replace('L30\n', '');
    const text = unifiedDiff(base, next);
    const chunks = text.split(/^@@ /m).slice(1);
    for (const chunk of chunks) {
      const [header, ...body] = chunk.split('\n');
      const m = header.match(/^-(\d+),(\d+) \+(\d+),(\d+) @@$/)!;
      expect(m).not.toBeNull();
      const rows = body.filter((l) => l !== '');
      expect(rows.filter((l) => l.startsWith(' ') || l.startsWith('-')).length).toBe(Number(m[2]));
      expect(rows.filter((l) => l.startsWith(' ') || l.startsWith('+')).length).toBe(Number(m[4]));
    }
  });
});

describe('deletions before additions', () => {
  it('emits the deletion first for a one-line replacement', () => {
    expect(shape(diffText('a\n', 'b\n').hunks[0])).toEqual(['-a', '+b']);
  });

  it('groups all deletions ahead of all additions in a replaced block', () => {
    const d = diffText('a\nb\nc\n', 'x\ny\nz\n');
    expect(shape(d.hunks[0])).toEqual(['-a', '-b', '-c', '+x', '+y', '+z']);
  });

  it('keeps the del-before-add order inside a hunk with context', () => {
    const base = lines(10);
    const next = replaceLine(replaceLine(base, 4, 'P'), 5, 'Q');
    const d = diffText(base, next);
    const marks = shape(d.hunks[0]).filter((s) => s[0] !== ' ');
    expect(marks).toEqual(['-L5', '-L6', '+P', '+Q']);
  });

  it('breaks an LCS tie toward the deletion when both paths are equal length', () => {
    // 'b' can be matched with either side; the tie-break must delete first.
    const d = diffText('a\nb\n', 'b\nc\n');
    expect(shape(d.hunks[0])).toEqual(['-a', ' b', '+c']);
  });

  it('orders a mid-file replacement as context, dels, adds, context', () => {
    const d = diffText(lines(9), replaceLine(replaceLine(lines(9), 3, 'X'), 4, 'Y'));
    expect(shape(d.hunks[0])).toEqual([' L1', ' L2', ' L3', '-L4', '-L5', '+X', '+Y', ' L6', ' L7', ' L8']);
  });

  it('puts deletions before additions in the truncated whole-file path too', () => {
    const big = lines(2001, (i) => `l${i}`);
    const d = diffText(big, replaceLine(big, 0, 'L0'));
    expect(d.truncated).toBe(true);
    const l = d.hunks[0].lines;
    expect(l.slice(0, 2001).every((x) => x.op === 'del')).toBe(true);
    expect(l.slice(2001).every((x) => x.op === 'add')).toBe(true);
  });
});

describe('determinism', () => {
  const cases: Array<[string, string]> = [
    [lines(30), replaceLine(lines(30), 12, 'CHANGED')],
    ['a\nb\nc\nd\n', 'a\nc\nb\nd\n'],
    ['', lines(5)],
    [lines(5), ''],
    ['x\nx\nx\n', 'x\nx\nx\nx\n'],
  ];

  it('produces byte-identical unified text across repeated calls', () => {
    for (const [a, b] of cases) {
      const first = unifiedDiff(a, b);
      for (let k = 0; k < 5; k++) expect(unifiedDiff(a, b)).toBe(first);
    }
  });

  it('produces structurally identical FileDiff objects across repeated calls', () => {
    for (const [a, b] of cases) {
      expect(JSON.stringify(diffText(a, b))).toBe(JSON.stringify(diffText(a, b)));
    }
  });

  it('is order-sensitive: swapping the sides inverts adds and dels', () => {
    const fwd = diffText(lines(6), lines(6) + 'L7\n');
    const rev = diffText(lines(6) + 'L7\n', lines(6));
    expect([fwd.additions, fwd.deletions]).toEqual([1, 0]);
    expect([rev.additions, rev.deletions]).toEqual([0, 1]);
  });

  it('stays deterministic on the truncated path', () => {
    const big = lines(2001, (i) => `l${i}`);
    const mod = replaceLine(big, 1000, 'CHANGED');
    expect(unifiedDiff(big, mod)).toBe(unifiedDiff(big, mod));
  });
});

describe('MAX_LCS_CELLS truncation', () => {
  // The cap is 4,000,000 cells and it is checked BEFORE prefix/suffix trimming,
  // so 2001x2001 lines degrade even when only one line actually differs.
  const big = lines(2001, (i) => `l${i}`);
  const bigMod = replaceLine(big, 1000, 'CHANGED');

  it('degrades to a whole-file replace and says so', () => {
    const d = diffText(big, bigMod);
    expect(d.truncated).toBe(true);
    expect(d.binary).toBe(false);
    expect(d.unchanged).toBe(false);
    expect([d.additions, d.deletions]).toEqual([2001, 2001]);
  });

  it('still returns a single well-formed hunk with consistent counts', () => {
    const d = diffText(big, bigMod);
    expect(d.hunks).toHaveLength(1);
    assertHunkCountsConsistent(d);
    expect(d.hunks[0]).toMatchObject({ oldStart: 1, oldCount: 2001, newStart: 1, newCount: 2001 });
    expect(d.hunks[0].lines).toHaveLength(4002);
  });

  it('numbers the degraded script from 1 on both sides', () => {
    const l = diffText(big, bigMod).hunks[0].lines;
    expect(l[0]).toEqual({ op: 'del', oldLine: 1, text: 'l0' });
    expect(l[2000]).toMatchObject({ op: 'del', oldLine: 2001 });
    expect(l[2001]).toEqual({ op: 'add', newLine: 1, text: 'l0' });
    expect(l[4001]).toMatchObject({ op: 'add', newLine: 2001 });
  });

  it('renders truncated output as valid unified text', () => {
    const text = unifiedDiff(big, bigMod);
    expect(text.split('\n').slice(0, 3)).toEqual(['--- a', '+++ b', '@@ -1,2001 +1,2001 @@']);
    expect(text.endsWith('\n')).toBe(true);
  });

  it('stays under the cap for 2000x2000 and produces a precise diff', () => {
    const under = lines(2000, (i) => `l${i}`);
    const d = diffText(under, replaceLine(under, 500, 'CHANGED'));
    expect(d.truncated).toBe(false);
    expect([d.additions, d.deletions]).toEqual([1, 1]);
    expect(d.hunks).toHaveLength(1);
  });

  it('truncates a wildly asymmetric pair without hanging or throwing', () => {
    const tiny = 'x\ny\nz\n';
    const huge = lines(1_400_001, (i) => `${i}`);
    const started = Date.now();
    const d = diffText(tiny, huge);
    expect(d.truncated).toBe(true);
    expect(d.hunks).toHaveLength(1);
    assertHunkCountsConsistent(d);
    expect(Date.now() - started).toBeLessThan(20_000);
  });

  it('feeds truncated output back through the parser intact', () => {
    const parsed = parseUnifiedDiff(unifiedDiff(big, bigMod));
    expect(parsed).toHaveLength(1);
    expect(parsed[0].hunks).toHaveLength(1);
    expect([parsed[0].additions, parsed[0].deletions]).toEqual([2001, 2001]);
  });
});

describe('round-tripping through parseUnifiedDiff', () => {
  const cases: Array<[string, string, string]> = [
    ['single change mid-file', lines(20), replaceLine(lines(20), 9, 'TEN')],
    ['insert at top plus change at bottom', lines(20), 'X\n' + replaceLine(lines(20), 17, 'L18-mod')],
    ['three separated changes', lines(60, (i) => `x${i}`), replaceLine(replaceLine(replaceLine(lines(60, (i) => `x${i}`), 5, 'A'), 25, 'B'), 45, 'C')],
    ['whole-file rewrite', 'a\nb\nc\n', 'x\ny\nz\n'],
    ['rotation', '1\n2\n3\n4\n5\n', '3\n4\n5\n1\n2\n'],
    ['create from empty', '', lines(4)],
    ['delete to empty', lines(4), ''],
  ];

  for (const [name, a, b] of cases) {
    it(`recovers hunk geometry for: ${name}`, () => {
      const source = diffText(a, b);
      const parsed = parseUnifiedDiff(toUnifiedDiff(source));
      expect(parsed).toHaveLength(1);
      expect(parsed[0].hunks).toHaveLength(source.hunks.length);
      expect(parsed[0].hunks.map((h) => [h.oldStart, h.oldCount, h.newStart, h.newCount])).toEqual(
        source.hunks.map((h) => [h.oldStart, h.oldCount, h.newStart, h.newCount]),
      );
      expect(parsed[0].additions).toBe(source.additions);
      expect(parsed[0].deletions).toBe(source.deletions);
    });

    it(`recovers line ops, text and numbering for: ${name}`, () => {
      const source = diffText(a, b);
      const parsed = parseUnifiedDiff(toUnifiedDiff(source));
      expect(parsed[0].hunks.flatMap((h) => h.lines)).toEqual(source.hunks.flatMap((h) => h.lines));
    });
  }

  it('re-renders parsed hunks to the same unified text', () => {
    const source = diffText(lines(20), 'X\n' + replaceLine(lines(20), 17, 'L18-mod'));
    const text = toUnifiedDiff(source);
    const parsed = parseUnifiedDiff(text)[0];
    const rerendered = toUnifiedDiff({
      ...parsed,
      unchanged: false,
      truncated: false,
      oldPath: source.oldPath,
      newPath: source.newPath,
    });
    expect(rerendered).toBe(text);
  });

  it('round-trips a two-file diff --git stream', () => {
    const text =
      'diff --git a/f1 b/f1\n' +
      toUnifiedDiff(diffText('a\n', 'b\n', { oldPath: 'a/f1', newPath: 'b/f1' })) +
      'diff --git a/f2 b/f2\n' +
      toUnifiedDiff(diffText(lines(10), replaceLine(lines(10), 4, 'Z'), { oldPath: 'a/f2', newPath: 'b/f2' }));
    const parsed = parseUnifiedDiff(text);
    expect(parsed).toHaveLength(2);
    expect(parsed.map((f) => [f.oldPath, f.newPath])).toEqual([
      ['f1', 'f1'],
      ['f2', 'f2'],
    ]);
    expect(parsed[1].hunks[0].oldStart).toBe(2);
    expect(parsed[1].additions).toBe(1);
  });

  it('strips the a/ and b/ prefixes from paths', () => {
    const parsed = parseUnifiedDiff('--- a/src/x.ts\n+++ b/src/x.ts\n@@ -1,1 +1,1 @@\n-a\n+b\n');
    expect([parsed[0].oldPath, parsed[0].newPath]).toEqual(['src/x.ts', 'src/x.ts']);
  });

  it('accepts the single-line "@@ -1 +1 @@" form git emits', () => {
    const parsed = parseUnifiedDiff('@@ -1 +1 @@\n-a\n+b\n');
    expect(parsed[0].hunks[0]).toMatchObject({ oldStart: 1, oldCount: 1, newStart: 1, newCount: 1 });
  });

  it('drops the "\\ No newline at end of file" marker without disturbing the body', () => {
    const parsed = parseUnifiedDiff('--- a\n+++ b\n@@ -1 +1 @@\n-a\n+b\n\\ No newline at end of file\n');
    expect(parsed[0].hunks[0].lines.map((l) => l.op)).toEqual(['del', 'add']);
  });
});

describe('parseUnifiedDiff never throws on hostile input', () => {
  const hostile: Array<[string, string]> = [
    ['empty string', ''],
    ['only whitespace', '   \n\t\n \n'],
    ['only newlines', '\n\n\n\n'],
    ['truncated header', '@@ -1,2 +\n'],
    ['header with no numbers', '@@ @@\n a\n'],
    ['bare @@', '@@\n'],
    ['non-numeric fields', '@@ -x,y +z,w @@\n a\n+b\n'],
    ['negative numbers', '@@ --1,2 +-3,4 @@\n a\n-b\n'],
    ['huge numbers', '@@ -999999999999999999999,2 +1,2 @@\n a\n+b\n'],
    ['huge counts', '@@ -1,99999999 +1,99999999 @@\n a\n'],
    ['body shorter than declared size', '@@ -1,50 +1,50 @@\n a\n'],
    ['body longer than declared size', '@@ -1,1 +1,1 @@\n a\n b\n c\n d\n'],
    ['CRLF throughout', '--- a/f\r\n+++ b/f\r\n@@ -1 +1 @@\r\n-a\r\n+b\r\n'],
    ['lone carriage returns', '@@ -1 +1 @@\r-a\r+b\r'],
    ['--- inside a hunk body', '--- a/f\n+++ b/f\n@@ -1,3 +1,3 @@\n x\n---- deep\n+++++ deep\n'],
    ['+++ before ---', '+++ b/x\n--- a/x\n@@ -1 +1 @@\n-a\n+b\n'],
    ['body with no header', ' orphan\n+orphan\n-orphan\n'],
    ['header inside header', '@@ -1,1 +1,1 @@ @@ -2,2 +2,2 @@\n a\n'],
    ['binary marker only', 'Binary files a/i and b/i differ\n'],
    ['git binary patch', 'GIT binary patch\nliteral 0\nHcmV?d00001\n'],
    ['diff --git with no hunks', 'diff --git a/f b/f\nnew file mode 100644\n'],
    ['NUL bytes in the stream', '@@ -1 +1 @@\n-a\0b\n+c\0d\n'],
    ['unterminated final line', '@@ -1,1 +1,1 @@\n-a'],
    ['header only, no body', '@@ -10,5 +10,5 @@'],
    ['emoji payload', '@@ -1 +1 @@\n-🎉\n+👍\n'],
    ['very long single line', '@@ -1 +1 @@\n-' + 'z'.repeat(200_000) + '\n'],
  ];

  for (const [name, input] of hostile) {
    it(`returns an array for: ${name}`, () => {
      let out: ReturnType<typeof parseUnifiedDiff> | undefined;
      expect(() => {
        out = parseUnifiedDiff(input);
      }).not.toThrow();
      expect(Array.isArray(out)).toBe(true);
      for (const f of out!) {
        expect(typeof f.oldPath).toBe('string');
        expect(typeof f.newPath).toBe('string');
        expect(Array.isArray(f.hunks)).toBe(true);
        expect(f.hunks.length > 0 || f.binary).toBe(true);
      }
    });
  }

  it('discards files that produced neither hunks nor a binary marker', () => {
    expect(parseUnifiedDiff('diff --git a/f b/f\n--- a/f\n+++ b/f\n')).toEqual([]);
    expect(parseUnifiedDiff('@@ -x +y @@\n a\n')).toEqual([]);
  });

  it('survives 10k malformed @@ lines quickly and yields nothing', () => {
    const started = Date.now();
    expect(parseUnifiedDiff('@@\n'.repeat(10_000))).toEqual([]);
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it('survives 10k valid @@ lines and keeps every empty hunk', () => {
    const started = Date.now();
    const parsed = parseUnifiedDiff('@@ -1,1 +1,1 @@\n'.repeat(10_000));
    expect(parsed).toHaveLength(1);
    expect(parsed[0].hunks).toHaveLength(10_000);
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it('reads a line starting with ---- inside a body as a deletion, not a new file', () => {
    const parsed = parseUnifiedDiff('--- a/f\n+++ b/f\n@@ -1,3 +1,3 @@\n x\n---- deep\n+++++ deep\n');
    expect(parsed).toHaveLength(1);
    expect(parsed[0].hunks[0].lines.map((l) => [l.op, l.text])).toEqual([
      ['normal', 'x'],
      ['del', '--- deep'],
      ['add', '++++ deep'],
    ]);
  });

  it('coerces an out-of-range start into a number without crashing', () => {
    const parsed = parseUnifiedDiff('@@ -999999999999999999999,2 +1,2 @@\n a\n+b\n');
    expect(parsed).toHaveLength(1);
    expect(Number.isFinite(parsed[0].hunks[0].oldStart)).toBe(true);
  });

  it('keeps declared counts even when the body is short (no re-derivation)', () => {
    const parsed = parseUnifiedDiff('@@ -1,50 +1,50 @@\n a\n');
    expect(parsed[0].hunks[0].oldCount).toBe(50);
    expect(parsed[0].hunks[0].lines).toHaveLength(1);
  });

  it('leaves \\r attached to text when parsing CRLF diffs', () => {
    const parsed = parseUnifiedDiff('--- a/f\r\n+++ b/f\r\n@@ -1 +1 @@\r\n-a\r\n+b\r\n');
    expect(parsed[0].hunks[0].lines.map((l) => l.text)).toEqual(['a\r', 'b\r']);
  });

  it('ignores body lines before any hunk header', () => {
    expect(parseUnifiedDiff('--- a/f\n+++ b/f\n garbage\n+garbage\n')).toEqual([]);
  });
});

describe('unicode integrity', () => {
  it('does not corrupt multi-byte characters', () => {
    const d = diffText('héllo wörld\ncafé\n', 'héllo wörld\ncafé!\n');
    expect(shape(d.hunks[0])).toEqual([' héllo wörld', '-café', '+café!']);
  });

  it('keeps emoji and ZWJ sequences whole', () => {
    const d = diffText('🎉\n👨‍👩‍👧\n', '🎉\n👍\n');
    expect(d.hunks[0].lines.map((l) => l.text)).toEqual(['🎉', '👨‍👩‍👧', '👍']);
  });

  it('distinguishes precomposed from decomposed forms', () => {
    const precomposed = 'é\n';
    const decomposed = 'é\n';
    const d = diffText(precomposed, decomposed);
    expect(d.unchanged).toBe(false);
    expect([d.additions, d.deletions]).toEqual([1, 1]);
    expect(d.hunks[0].lines.map((l) => l.text)).toEqual(['é', 'é']);
  });

  it('treats identical decomposed text as unchanged', () => {
    expect(diffText('é\n', 'é\n').unchanged).toBe(true);
  });

  it('splits lines on \\n only, ignoring unicode line separators', () => {
    const d = diffText('a b\n', 'a c\n');
    expect(d.hunks[0].oldCount).toBe(1);
    expect(d.hunks[0].lines[0].text).toBe('a b');
  });

  it('round-trips unicode through the unified form', () => {
    const a = 'ключ\n值\n🚀\n';
    const b = 'ключ\n值段\n🚀\n';
    const parsed = parseUnifiedDiff(unifiedDiff(a, b));
    expect(parsed[0].hunks[0].lines).toEqual(diffText(a, b).hunks[0].lines);
  });

  it('handles a lone surrogate without throwing', () => {
    expect(() => diffText('\ud800\n', '\udc00\n')).not.toThrow();
    expect(diffText('\ud800\n', '\udc00\n').additions).toBe(1);
  });
});

describe('groupHunks edge cases', () => {
  it('anchors a pure-insertion hunk at the preceding old line', () => {
    const d = diffText('a\nb\n', 'a\nNEW\nb\n');
    expect(d.hunks[0]).toMatchObject({ oldStart: 1, oldCount: 2, newStart: 1, newCount: 3 });
  });

  it('anchors a leading insertion at old line 1 when there is no preceding line', () => {
    const d = diffText('a\n', 'NEW\na\n');
    expect(d.hunks[0]).toMatchObject({ oldStart: 1, oldCount: 1, newStart: 1, newCount: 2 });
  });

  it('falls back to 0 for a side with no lines at all', () => {
    const h = groupHunks([{ op: 'del', oldLine: 1, text: 'a' }], 100);
    expect(h[0]).toMatchObject({ oldStart: 1, oldCount: 1, newStart: 0, newCount: 0 });
  });

  it('respects a caller-supplied context when grouping a raw script', () => {
    const s = script(20, [[10, 'del']]);
    expect(groupHunks(s, 0)[0].lines).toHaveLength(1);
    expect(groupHunks(s, 2)[0].lines).toHaveLength(5);
    expect(groupHunks(s, 5)[0].lines).toHaveLength(11);
  });

  it('produces hunks whose lines are a contiguous slice of the script', () => {
    const s = script(30, [[5, 'del'], [20, 'add']]);
    const hunks = groupHunks(s, 3);
    expect(hunks).toHaveLength(2);
    for (const h of hunks) {
      const start = s.indexOf(h.lines[0]);
      expect(s.slice(start, start + h.lines.length)).toEqual(h.lines);
    }
  });
});





