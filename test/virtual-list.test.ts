import { describe, it, expect } from 'vitest';
import { computeVisibleRange } from '../components/useVirtualList';

/* ------------------------------------------------------------------ */
/*  computeVisibleRange — the load-bearing windowing math.             */
/*                                                                     */
/*  `positions` is the prefix-sum of row tops: positions[i] = top of   */
/*  row i, positions[count] = total height. The function must find     */
/*  exactly the rows intersecting [scrollTop, scrollTop+viewport]      */
/*  with overscan margins, using binary search (a linear scan would    */
/*  defeat the point of virtualizing).                                 */
/* ------------------------------------------------------------------ */

/** Uniform 40px rows helper. */
const uniform = (count: number, height = 40): number[] => {
  const out = [0];
  for (let i = 0; i < count; i++) out.push(out[i] + height);
  return out;
};

describe('computeVisibleRange', () => {
  it('returns an empty range for an empty list', () => {
    expect(computeVisibleRange(0, 600, [0], 8)).toEqual({ start: 0, end: 0 });
    expect(computeVisibleRange(0, 600, [], 8)).toEqual({ start: 0, end: 0 });
  });

  it('renders at least one row even with a zero-height viewport', () => {
    // During first layout viewportHeight can be 0; the range must still be
    // non-empty so the row can be measured and the layout can converge.
    const range = computeVisibleRange(0, 0, uniform(10), 8);
    expect(range.end).toBeGreaterThan(range.start);
  });

  it('shows the first window plus overscan at the top', () => {
    const range = computeVisibleRange(0, 400, uniform(100), 8);
    // viewport 400px / 40px rows = 10 visible rows (0..9), +8 overscan below.
    expect(range.start).toBe(0);
    expect(range.end).toBe(18);
  });

  it('shows overscan on BOTH sides when scrolled to the middle', () => {
    // scrollTop 2000 → first visible row 50 (bottom edge at 2040 > 2000).
    const range = computeVisibleRange(2000, 400, uniform(100), 8);
    expect(range.start).toBe(42); // 50 - 8
    // last visible: first row whose top >= 2400 → row 60; end = 60 + 8.
    expect(range.end).toBe(68);
  });

  it('clamps at the bottom of the list, even at/past total height', () => {
    const positions = uniform(100); // total 4000
    // scrollTop equal to total height (overscroll): resolve to the last row.
    const atEnd = computeVisibleRange(4000, 400, positions, 0);
    expect(atEnd).toEqual({ start: 99, end: 100 });
    // Past the end (stale scrollTop after rows were removed) — same clamp.
    const pastEnd = computeVisibleRange(999_999, 400, positions, 8);
    expect(pastEnd.start).toBe(99 - 8);
    expect(pastEnd.end).toBe(100);
  });

  it('handles variable row heights (deep rows mixed with compact rows)', () => {
    // Rows: 0 compact (40), 1 deep (1000), 2 compact (40), ...
    const positions = [0, 40, 1040, 1080, 1120, 1160, 1200, 1240, 1280, 1320, 1360];
    // Viewport [50, 150) intersects ONLY row 1 (40..1040): row 2 starts at
    // 1040, far below the viewport bottom.
    const range = computeVisibleRange(50, 100, positions, 0);
    expect(range).toEqual({ start: 1, end: 2 });
    // Viewport [1000, 1100) intersects rows 1 (..1040), 2 (1040..1080), and
    // 3 (1080..1120, top 1080 < 1100).
    const tail = computeVisibleRange(1000, 100, positions, 0);
    expect(tail).toEqual({ start: 1, end: 4 });
  });

  it('a single row taller than the viewport is fully in range', () => {
    const positions = [0, 5000];
    const range = computeVisibleRange(0, 400, positions, 0);
    expect(range).toEqual({ start: 0, end: 1 });
    // Scrolled deep into the giant row, still exactly that row.
    expect(computeVisibleRange(4000, 400, positions, 0)).toEqual({ start: 0, end: 1 });
  });

  it('zero overscan returns exactly the intersecting rows', () => {
    const range = computeVisibleRange(80, 40, uniform(100), 0);
    // Row 2 spans [80,120) — top edge exactly at scrollTop.
    expect(range).toEqual({ start: 2, end: 3 });
  });

  it('negative scrollTop (rubber-banding) clamps to the top', () => {
    const range = computeVisibleRange(-200, 400, uniform(100), 4);
    expect(range.start).toBe(0);
  });

  it('is O(log n): handles a million rows without scanning', () => {
    const count = 1_000_000;
    const height = 40;
    const positions = new Array(count + 1);
    for (let i = 0; i <= count; i++) positions[i] = i * height;
    const range = computeVisibleRange(20_000_000, 400, positions as number[], 8);
    expect(range.start).toBe(Math.max(0, 500_000 - 8));
    expect(range.end).toBe(500_010 + 8);
  });
});
