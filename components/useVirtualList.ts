'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/* ------------------------------------------------------------------ */
/*  useVirtualList — dependency-free list windowing.                   */
/*                                                                     */
/*  WHY THIS EXISTS (Gate 3 C2): the Activity timeline previously      */
/*  CAPPED rendering at the newest 200 rows and told the user how      */
/*  many were hidden. A cap truncates history; virtualization shows    */
/*  ALL of it while materializing only the visible window plus an      */
/*  overscan margin. For the terminal, xterm.js already virtualizes    */
/*  its own rendering internally (scrollback lives in a buffer, not    */
/*  the DOM), so no second windowing layer is added there.             */
/*                                                                     */
/*  VARIABLE ROW HEIGHTS ARE THE HARD PART here: a deep-mode event     */
/*  row is ~7x taller than a compact one. Rows are therefore           */
/*  MEASURED (ResizeObserver per row) and laid out with prefix-sum     */
/*  offsets; unmeasured rows fall back to a caller-provided            */
/*  estimate so the very first paint is approximately correct and      */
/*  converges to exact positions as measurements land.                 */
/*                                                                     */
/*  AUTOSCROLL CONTRACT: a list that was pinned to the bottom keeps    */
/*  following new rows; the moment the user scrolls up, pinning stops  */
/*  (same semantics the run log already has, so both surfaces          */
/*  behave identically).                                               */
/* ------------------------------------------------------------------ */

/** Rows kept alive above and below the viewport. */
export const VIRTUAL_OVERSCAN = 8;

/**
 * Compute the visible index range from prefix-sum positions.
 *
 * Pure on purpose: the binary searches are the load-bearing logic and are
 * unit-tested directly (test/virtual-list.test.ts). `positions[i]` is the
 * TOP offset of row i; `positions[count]` is the total height.
 *
 * Returns [start, end) — end is exclusive, and at least one row is returned
 * when count > 0 so an empty viewport (height 0 during first measure) still
 * renders something and can be measured itself.
 */
export function computeVisibleRange(
  scrollTop: number,
  viewportHeight: number,
  positions: number[],
  overscan: number,
): { start: number; end: number } {
  const count = positions.length - 1;
  if (count <= 0) return { start: 0, end: 0 };

  // First row whose BOTTOM edge is below the top edge of the viewport.
  let lo = 0;
  let hi = count;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (positions[mid + 1] <= scrollTop) lo = mid + 1;
    else hi = mid;
  }
  // Clamp: a scrollTop at or past the end of the list (overscroll, or a
  // stale scrollTop after rows were removed) must resolve to the LAST row,
  // never to an out-of-bounds index.
  const firstVisible = Math.min(lo, count - 1);

  // First row whose TOP edge is at or below the bottom edge of the viewport.
  const bottom = scrollTop + Math.max(0, viewportHeight);
  let blo = firstVisible;
  let bhi = count;
  while (blo < bhi) {
    const mid = (blo + bhi) >> 1;
    if (positions[mid] < bottom) blo = mid + 1;
    else bhi = mid;
  }
  // blo is the first fully-below row; it is the exclusive end candidate.
  const lastExclusive = Math.max(blo, firstVisible + 1);

  return {
    start: Math.max(0, firstVisible - overscan),
    end: Math.min(count, lastExclusive + overscan),
  };
}

export interface UseVirtualListArgs {
  count: number;
  /**
   * Estimated pixel height of row `i` before it has been measured. Must be a
   * stable reference (useCallback) — it is read through a ref, so callers
   * must not allocate it inline per render if it closes over state.
   */
  estimateRowHeight: (index: number) => number;
  overscan?: number;
  /** Follow the bottom while already pinned there. Default true. */
  followBottom?: boolean;
  /** Scroll to the bottom on first layout. Default false. */
  startAtBottom?: boolean;
}

export interface VirtualListController {
  /** Attach to the scrolling container element. */
  scrollRef: (node: HTMLElement | null) => void;
  /**
   * Attach to each absolutely-positioned row wrapper so its height can be
   * measured. One observer per mounted row (only the window, not all rows).
   */
  rowRef: (index: number) => (node: HTMLElement | null) => void;
  /** [start, end) of rows to render. */
  start: number;
  end: number;
  /** Sum of all row heights; the spacer div's height. */
  totalHeight: number;
  /** Top offset of row `index` — the row wrapper's `top`. */
  topOf: (index: number) => number;
  /** True while the list is pinned to the bottom (drives "follow" behavior). */
  pinned: boolean;
}

export function useVirtualList({
  count,
  estimateRowHeight,
  overscan = VIRTUAL_OVERSCAN,
  followBottom = true,
  startAtBottom = false,
}: UseVirtualListArgs): VirtualListController {
  const scrollElRef = useRef<HTMLElement | null>(null);
  const estimatorRef = useRef(estimateRowHeight);
  estimatorRef.current = estimateRowHeight;

  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  /** index -> measured px height. Survives window moves by key, not node. */
  const [heights, setHeights] = useState<Map<number, number>>(() => new Map());
  const heightsRef = useRef(heights);
  heightsRef.current = heights;
  const [pinned, setPinned] = useState(startAtBottom);
  const didInitialScrollRef = useRef(false);
  const pendingInitialRef = useRef(startAtBottom);

  /* Prefix-sum offsets from measured heights + estimates. */
  const positions = useMemo(() => {
    const offsets: number[] = new Array(count + 1);
    offsets[0] = 0;
    for (let i = 0; i < count; i++) {
      const measured = heights.get(i);
      offsets[i + 1] = offsets[i] + (measured !== undefined ? measured : estimatorRef.current(i));
    }
    return offsets;
    // heights is a Map replaced wholesale on measurement batches
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count, heights]);

  const totalHeight = positions[count] ?? 0;

  const { start, end } = computeVisibleRange(scrollTop, viewportHeight, positions, overscan);

  /* Scroll: record offset, recompute pinning from the DOM's own geometry. */
  const handleScroll = useCallback(() => {
    const el = scrollElRef.current;
    if (!el) return;
    const nextTop = el.scrollTop;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    setScrollTop(nextTop);
    if (followBottom) setPinned(atBottom);
  }, [followBottom]);

  const scrollRef = useCallback(
    (node: HTMLElement | null) => {
      scrollElRef.current = node;
      if (node) {
        node.addEventListener('scroll', handleScroll, { passive: true });
        setViewportHeight(node.clientHeight);
        if (pendingInitialRef.current) {
          // Defer to the next frame: the spacer needs a layout pass with the
          // estimated heights before max scrollTop exists.
          requestAnimationFrame(() => {
            if (scrollElRef.current && !didInitialScrollRef.current) {
              didInitialScrollRef.current = true;
              scrollElRef.current.scrollTop = scrollElRef.current.scrollHeight;
              handleScroll();
            }
          });
        }
      }
    },
    [handleScroll],
  );

  /* Viewport resize keeps the window correct when the pane grows/shrinks. */
  useEffect(() => {
    const el = scrollElRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      setViewportHeight(el.clientHeight);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  /* Follow the bottom while pinned (new rows arrive -> stay glued).
     Runs after every render while pinned; guarded by the distance check so
     it converges instead of looping. */
  useEffect(() => {
    if (!pinned) return;
    const el = scrollElRef.current;
    if (!el) return;
    const target = el.scrollHeight - el.clientHeight;
    if (Math.abs(el.scrollTop - target) > 1) {
      el.scrollTop = target;
      setScrollTop(target);
    }
    // positions/totalHeight change as rows arrive and are measured; reading
    // them through the ref-free closure would need the full dependency list,
    // which the scroll-follow effect does not require — it re-checks after
    // every render that `pinned` is true, which is exactly the semantic.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinned, count, totalHeight]);

  /* Row measurement: one ResizeObserver per MOUNTED row only. */
  const rowObserversRef = useRef(new Map<number, ResizeObserver>());
  const rowRef = useCallback((index: number) => {
    return (node: HTMLElement | null) => {
      const observers = rowObserversRef.current;
      const previous = observers.get(index);
      if (previous) {
        previous.disconnect();
        observers.delete(index);
      }
      if (!node) return;
      const record = (height: number) => {
        const known = heightsRef.current.get(index);
        if (known === height) return;
        setHeights((prev) => {
          const next = new Map(prev);
          next.set(index, height);
          return next;
        });
      };
      record(node.getBoundingClientRect().height);
      if (typeof ResizeObserver !== 'undefined') {
        const observer = new ResizeObserver((entries) => {
          for (const entry of entries) record(entry.contentRect.height);
        });
        observer.observe(node);
        observers.set(index, observer);
      }
    };
  }, []);

  /* Disconnect any stragglers. */
  useEffect(() => {
    const observers = rowObserversRef.current;
    return () => {
      for (const observer of observers.values()) observer.disconnect();
      observers.clear();
    };
  }, []);

  const topOf = useCallback((index: number) => positions[index] ?? 0, [positions]);

  return { scrollRef, rowRef, start, end, totalHeight, topOf, pinned };
}
