'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge, Button, EmptyState, Spinner, cx } from '@/components/ui';

/* ------------------------------------------------------------------ */
/*  Terminal — xterm.js wrapper backed by a server-side PTY session.   */
/*                                                                     */
/*  INVARIANT: create -> returned id -> stream -> write -> resize ->   */
/*  kill all operate on ONE session id.                                */
/*                                                                     */
/*  HOW IT IS HELD:                                                    */
/*   - Identity lives in refs, never in render state. Async closures    */
/*     read the CURRENT id at call time, so a stale boot can never     */
/*     address another boot's session.                                 */
/*   - A generation token makes boot single-flight: only the newest    */
/*     invocation may wire IO; a superseded one deletes its own PTY    */
/*     instead of leaking it (React StrictMode double-mount included). */
/*   - Every write/resize is gated on a liveness flag that flips on    */
/*     exit/error frames, so a dead session receives no further POSTs  */
/*     — the repeated-404 loop is structurally impossible.             */
/*   - Resizing is driven solely by a ResizeObserver on the container; */
/*     there are no window listeners to leak.                          */
/* ------------------------------------------------------------------ */

interface TerminalSessionInfo {
  id: string;
  taskId: string;
  cols: number;
  rows: number;
  createdAt: number;
  cwd: string;
}

type Phase = 'idle' | 'connecting' | 'ready' | 'exited' | 'error';

interface TerminalProps {
  taskId: string;
  /** DELETE the session on unmount. Default true — a tab switch must not leak a shell. */
  autoKill?: boolean;
  className?: string;
}

export default function Terminal({ taskId, autoKill = true, className = '' }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<import('@xterm/xterm').Terminal | null>(null);
  const fitRef = useRef<import('@xterm/addon-fit').FitAddon | null>(null);
  const sourceRef = useRef<EventSource | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  /**
   * Serialized write queue. Keystroke POSTs fired in parallel are NOT ordered
   * by the browser: independent fetch() calls may ride different keep-alive
   * connections and be applied to the PTY out of order, scrambling fast typing
   * (observed in browser E2E: "echo BROWSER..." reached bash as "echoWO SER...").
   * Chaining each POST behind the previous one keeps byte order exactly as
   * typed; the payload is a handful of bytes, so the queue never grows past a
   * few pending promises even during a paste.
   */
  const writeChainRef = useRef<Promise<void>>(Promise.resolve());
  /** True only while this mount owns a live PTY. Gates ALL outbound IO. */
  const aliveRef = useRef(false);
  /** Monotonic generation counter — the newest boot wins, older ones self-destruct their PTY. */
  const bootTokenRef = useRef(0);
  const disposedRef = useRef(false);

  const [phase, setPhase] = useState<Phase>('idle');
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [error, setError] = useState('');

  /**
   * Stop streaming and drop identity. `kill` additionally DELETEs the server
   * session (best-effort). The xterm DOM is intentionally left intact on
   * exit/error so the user keeps the scrollback that explains what happened.
   */
  const stopIO = useCallback(
    (kill: boolean) => {
      aliveRef.current = false;
      sourceRef.current?.close();
      sourceRef.current = null;
      const id = sessionIdRef.current;
      sessionIdRef.current = null;
      if (kill && autoKill && id) {
        fetch(`/api/tasks/${taskId}/terminal/${id}`, { method: 'DELETE' }).catch((err) =>
          console.warn('[terminal] cleanup delete failed:', err),
        );
      }
    },
    [taskId, autoKill],
  );

  const boot = useCallback(async () => {
    if (aliveRef.current) return;
    const token = ++bootTokenRef.current;
    disposedRef.current = false;
    setPhase('connecting');
    setError('');
    setExitCode(null);

    let ownedId: string | null = null; // a session THIS boot created (and must clean up on failure)
    try {
      // Dynamic imports — xterm touches window and is not SSR-safe.
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import('@xterm/xterm'),
        import('@xterm/addon-fit'),
      ]);

      // RECONNECT BEFORE CREATE. A full-page reload runs no React cleanup, so
      // this task may already own a live session from the previous mount.
      // Attaching to it (the stream replays its scrollback) both survives the
      // reload — a browser refresh no longer orphans the shell — and keeps ONE
      // session per task instead of one per reload. Extra sessions beyond the
      // newest are deleted: exactly one survives.
      let sessionId: string | null = null;
      try {
        const listRes = await fetch(`/api/tasks/${taskId}/terminal`, { cache: 'no-store' });
        if (listRes.ok) {
          const body = (await listRes.json()) as { sessions?: TerminalSessionInfo[] };
          const live = (body.sessions ?? []).slice().sort((a, b) => b.createdAt - a.createdAt);
          if (live.length > 0) {
            sessionId = live[0].id;
            for (const stale of live.slice(1)) {
              fetch(`/api/tasks/${taskId}/terminal/${stale.id}`, { method: 'DELETE' }).catch(() => {});
            }
          }
        }
      } catch {
        /* listing is best-effort; a failure falls through to create */
      }

      if (!sessionId) {
        const res = await fetch(`/api/tasks/${taskId}/terminal`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({}),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error || `Could not create terminal (${res.status}).`);
        }
        sessionId = ((await res.json()) as TerminalSessionInfo).id;
        ownedId = sessionId;
      }

      // Superseded (StrictMode remount, rapid retry) or unmounted mid-flight:
      // a session THIS boot created is an orphan. Delete it NOW — never leave
      // it bound to a dead closure where it could receive writes aimed at
      // nobody. A reconnected (pre-existing) session is left for its next
      // mount; it does not belong to this closure.
      if (token !== bootTokenRef.current || disposedRef.current) {
        if (ownedId) {
          fetch(`/api/tasks/${taskId}/terminal/${ownedId}`, { method: 'DELETE' }).catch((err) =>
            console.warn('[terminal] orphan delete failed:', err),
          );
        }
        return;
      }

      sessionIdRef.current = sessionId;

      const term = new Terminal({
        cursorBlink: true,
        fontSize: 13,
        fontFamily: "ui-monospace, 'SF Mono', 'Cascadia Code', monospace",
        // Bounded scrollback. xterm holds every retained line in the DOM, so
        // an unbounded buffer is an unbounded DOM; 5000 lines is minutes of
        // `yes` output and everything a human scrolls back through.
        scrollback: 5000,
        theme: {
          background: '#0b111c',
          foreground: '#a0adc0',
          cursor: '#5ed6eb',
          selectionBackground: 'rgba(94,214,235,0.24)',
        },
      });
      const fit = new FitAddon();
      term.loadAddon(fit);

      const container = containerRef.current;
      if (!container) throw new Error('Terminal container is not mounted.');
      termRef.current?.dispose();
      term.open(container);
      fit.fit();
      termRef.current = term;
      fitRef.current = fit;
      aliveRef.current = true;

      // IO reads identity + liveness AT CALL TIME. Once aliveRef flips — on
      // exit, error, or replacement — this terminal can no longer produce a
      // request against a dead session id. Writes are chained so concurrent
      // keystrokes cannot reach the PTY out of order (see writeChainRef).
      term.onData((data: string) => {
        const sid = sessionIdRef.current;
        if (!aliveRef.current || !sid) return;
        writeChainRef.current = writeChainRef.current
          .catch(() => {
            /* a failed write must not block the queue */
          })
          .then(() =>
            fetch(`/api/tasks/${taskId}/terminal/${sid}`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ data }),
            })
              .then(() => undefined)
              .catch((err) => console.warn('[terminal] write failed:', err)),
          );
      });

      term.onResize(({ cols, rows }: { cols: number; rows: number }) => {
        const sid = sessionIdRef.current;
        if (!aliveRef.current || !sid) return;
        fetch(`/api/tasks/${taskId}/terminal/${sid}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ cols, rows }),
        }).catch((err) => console.warn('[terminal] resize failed:', err));
      });

      const source = new EventSource(`/api/tasks/${taskId}/terminal/${sessionId}/stream`);
      sourceRef.current = source;

      source.onopen = () => {
        if (token === bootTokenRef.current) setPhase('ready');
      };

      source.onmessage = (e: MessageEvent) => {
        if (token !== bootTokenRef.current) return;
        try {
          const msg = JSON.parse(e.data as string) as {
            type: string;
            data?: string;
            code?: number;
          };
          if (msg.type === 'output') {
            setPhase((p) => (p === 'connecting' ? 'ready' : p));
            term.write(msg.data ?? '');
          } else if (msg.type === 'scrollback') {
            term.write(msg.data ?? '');
          } else if (msg.type === 'exit') {
            setExitCode(typeof msg.code === 'number' ? msg.code : null);
            setPhase('exited');
            // Process is gone server-side; nothing left to delete.
            stopIO(false);
          } else if (msg.type === 'error') {
            setError(String(msg.data ?? 'Terminal error.'));
            setPhase('error');
            // Server-side state unknown — best-effort delete prevents leaks.
            stopIO(true);
          }
        } catch {
          /* malformed frame — ignore */
        }
      };

      source.onerror = () => {
        // Normal server close (after exit/error frames) also lands here;
        // only treat it as fatal while the session is supposed to be alive.
        if (!aliveRef.current || token !== bootTokenRef.current) return;
        setError('Stream connection lost.');
        setPhase('error');
        stopIO(true);
      };
    } catch (err) {
      // Failure paths still own a session THEY created until proven otherwise;
      // a reconnected pre-existing session survives a failed attach (the next
      // mount, or this task's rail, can still reach it).
      const superseded = token !== bootTokenRef.current || disposedRef.current;
      if (ownedId) {
        fetch(`/api/tasks/${taskId}/terminal/${ownedId}`, { method: 'DELETE' }).catch(() => {});
      }
      if (!superseded) {
        setError(err instanceof Error ? err.message : String(err));
        setPhase('error');
        stopIO(false);
      }
    }
  }, [taskId, stopIO]);

  /* Mount once per taskId. StrictMode double-mount resolves through the
     boot token: the first boot deletes its own orphan, the second wins. */
  useEffect(() => {
    void boot();
    return () => {
      disposedRef.current = true;
      stopIO(true);
      try {
        termRef.current?.dispose();
      } catch {
        /* already disposed */
      }
      termRef.current = null;
      fitRef.current = null;
    };
  }, [boot, stopIO]);

  /* Container-driven resize ONLY — no window listeners to leak. */
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => fitRef.current?.fit());
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const busy = phase === 'connecting';

  return (
    <div className={cx('flex h-full flex-col', className)}>
      {/* Toolbar */}
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line-subtle px-3">
        <span className="text-micro font-semibold uppercase tracking-[0.14em] text-content-muted">
          Terminal
        </span>
        {phase === 'ready' && (
          <Badge tone="emerald" dot pulse>
            live
          </Badge>
        )}
        {phase === 'connecting' && (
          <Badge tone="cyan">
            <Spinner className="h-2 w-2" />
            connecting
          </Badge>
        )}
        {phase === 'exited' && (
          <Badge tone="gray">exited{exitCode !== null ? ` · ${exitCode}` : ''}</Badge>
        )}
        {phase === 'error' && <Badge tone="red">error</Badge>}
        {sessionIdRef.current && phase === 'ready' && (
          <span className="font-mono text-micro text-content-faint">
            {sessionIdRef.current.slice(0, 8)}
          </span>
        )}
        <div className="flex-1" />
        {(phase === 'error' || phase === 'exited') && (
          <Button size="sm" variant="secondary" onClick={() => void boot()} disabled={busy}>
            New session
          </Button>
        )}
      </div>

      {/* Terminal body */}
      <div className="relative min-h-0 flex-1 bg-[#0b111c] p-1">
        {(phase === 'idle' || busy) && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Spinner className="text-content-muted" />
          </div>
        )}
        {phase === 'error' && !termRef.current && (
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <EmptyState title="Terminal unavailable" description={error} />
          </div>
        )}
        <div ref={containerRef} className="h-full w-full" />
        {phase === 'exited' && (
          <div className="absolute bottom-2 right-3 rounded-control border border-line-subtle bg-ink-700/90 px-2 py-1 text-micro text-content-muted">
            Session ended{exitCode !== null ? ` with code ${exitCode}` : ''}. Start a new one to continue.
          </div>
        )}
      </div>
    </div>
  );
}
