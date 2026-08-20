'use client';

import { useState, useEffect, useCallback } from 'react';

interface ReadinessResult {
  ok: boolean;
  method: string;
  signal: string;
  reason: string;
  evidence: string[];
  elapsed: number;
}

interface PreviewStatus {
  running: boolean;
  taskId: string;
  type: string;
  port: number;
  startedAt: number;
  expiresAt: number;
  remainingMs: number;
  logs: string[];
  strategy?: {
    runtime: string;
    entryFile?: string;
    buildCommand?: string;
    startCommand?: string;
    port?: number;
    ttlMs?: number;
    serveRoot?: string;
  };
  readiness?: ReadinessResult;
}

interface EnvInfo {
  envVars: string[];
  files: { path: string; vars: string[] }[];
}

interface BrowserTestResult {
  ok: boolean;
  message?: string;
  error?: string;
  steps?: { action: string; ok: boolean; error?: string }[];
}

export function PreviewPanel({ taskId, isTerminal }: { taskId: string; isTerminal: boolean }) {
  const [preview, setPreview] = useState<PreviewStatus | null>(null);
  const [env, setEnv] = useState<EnvInfo | null>(null);
  const [envValues, setEnvValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showEnv, setShowEnv] = useState(false);
  const [showStrategy, setShowStrategy] = useState(false);
  const [showReadiness, setShowReadiness] = useState(false);
  const [browserUrl, setBrowserUrl] = useState('http://127.0.0.1:3000');
  const [browserClickSelector, setBrowserClickSelector] = useState('');
  const [browserTypeSelector, setBrowserTypeSelector] = useState('');
  const [browserText, setBrowserText] = useState('Xeo Forge browser test');
  const [confirmSensitive, setConfirmSensitive] = useState(false);
  const [browserTesting, setBrowserTesting] = useState(false);
  const [browserTest, setBrowserTest] = useState<BrowserTestResult | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/tasks/${taskId}/preview`);
      if (res.ok) {
        const d = await res.json();
        setPreview(d.preview);
        setEnv(d.env);
      }
    } catch (err) {
      // Poll failure (offline, navigation abort) keeps the last known state
      // rather than blanking the panel. Logged so a persistent failure is
      // visible in the console instead of silently freezing the UI.
      console.warn('[preview] status refresh failed:', err);
    }
  }, [taskId]);

  useEffect(() => { refresh(); }, [refresh]);

  // Poll status when preview is running
  useEffect(() => {
    if (!preview?.running) return;
    const id = setInterval(refresh, 3000);
    return () => clearInterval(id);
  }, [preview?.running, refresh]);

  const start = async () => {
    setLoading(true);
    setError(null);
    try {
      // First analyze, then start with the detected strategy
      const analyzeRes = await fetch(`/api/tasks/${taskId}/preview?action=analyze`);
      let strategy: Record<string, unknown> = { runtime: 'static' };
      if (analyzeRes.ok) {
        const { analysis } = await analyzeRes.json();
        strategy = {
          runtime: analysis.runtime,
          entryFile: analysis.entryFile || undefined,
          buildCommand: analysis.buildCommand || undefined,
          startCommand: analysis.startCommand || undefined,
        };
      }

      const res = await fetch(`/api/tasks/${taskId}/preview`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...strategy, envVars: envValues }),
      });
      const d = await res.json();
      if (!res.ok) {
        setError(d.error || 'Failed to start');
        if (d.readiness) setError(`Readiness failed: ${d.readiness.reason}`);
      } else {
        setPreview({ ...d, running: true, logs: d.readiness ? [`Started ${d.type} preview`] : [] });
      }
    } catch { setError('Network error'); }
    finally { setLoading(false); }
  };

  const stop = async () => {
    await fetch(`/api/tasks/${taskId}/preview`, { method: 'DELETE' });
    setPreview(null);
  };

  const runBrowserTest = async () => {
    setBrowserTesting(true);
    setBrowserTest(null);
    try {
      const response = await fetch('/api/browser/preview-test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          url: browserUrl.trim(),
          clickSelector: browserClickSelector.trim() || undefined,
          typeSelector: browserTypeSelector.trim() || undefined,
          text: browserText,
          confirmSensitive,
        }),
      });
      const result = await response.json().catch(() => ({}));
      setBrowserTest(result);
    } catch {
      setBrowserTest({ ok: false, error: 'Could not reach the local browser test endpoint.' });
    } finally {
      setBrowserTesting(false);
    }
  };

  const browserCapabilityPanel = (
    <section className="rounded-xl border border-cyan-300/15 bg-cyan-300/[0.035] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-300/80">Browser capability check</div>
          <h3 className="mt-1 text-sm font-medium text-gray-200">Test the connected browser, not just the app server</h3>
          <p className="mt-1 max-w-2xl text-[11px] leading-5 text-gray-500">This runs locally through your selected extension profile. Navigate is tested first; click and type run only when you provide selectors and explicitly confirm sensitive interaction.</p>
        </div>
        <span className="rounded-full bg-cyan-300/10 px-2 py-1 text-[10px] text-cyan-200">local bridge</span>
      </div>
      <div className="mt-4 grid gap-2 md:grid-cols-2">
        <label className="space-y-1 md:col-span-2"><span className="text-[10px] uppercase tracking-[0.12em] text-gray-500">URL in the local allowlist</span><input value={browserUrl} onChange={(event) => setBrowserUrl(event.target.value)} type="url" placeholder="http://127.0.0.1:3000" className="w-full rounded-md border border-white/10 bg-black/10 px-3 py-2 text-xs text-gray-200 outline-none placeholder:text-gray-700 focus:border-cyan-300/40" /></label>
        <label className="space-y-1"><span className="text-[10px] uppercase tracking-[0.12em] text-gray-500">Click selector (optional)</span><input value={browserClickSelector} onChange={(event) => setBrowserClickSelector(event.target.value)} placeholder="button[data-test=save]" className="w-full rounded-md border border-white/10 bg-black/10 px-3 py-2 text-xs text-gray-200 outline-none placeholder:text-gray-700 focus:border-cyan-300/40" /></label>
        <label className="space-y-1"><span className="text-[10px] uppercase tracking-[0.12em] text-gray-500">Type selector (optional)</span><input value={browserTypeSelector} onChange={(event) => setBrowserTypeSelector(event.target.value)} placeholder="input[name=email]" className="w-full rounded-md border border-white/10 bg-black/10 px-3 py-2 text-xs text-gray-200 outline-none placeholder:text-gray-700 focus:border-cyan-300/40" /></label>
        {(browserClickSelector.trim() || browserTypeSelector.trim()) && <label className="flex items-center gap-2 text-[11px] text-gray-400 md:col-span-2"><input type="checkbox" checked={confirmSensitive} onChange={(event) => setConfirmSensitive(event.target.checked)} className="accent-cyan-400" />I understand click/type can change the page and I explicitly approve this local test.</label>}
        {browserTypeSelector.trim() && <label className="space-y-1 md:col-span-2"><span className="text-[10px] uppercase tracking-[0.12em] text-gray-500">Text to type</span><input value={browserText} onChange={(event) => setBrowserText(event.target.value)} className="w-full rounded-md border border-white/10 bg-black/10 px-3 py-2 text-xs text-gray-200 outline-none focus:border-cyan-300/40" /></label>}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button onClick={runBrowserTest} disabled={browserTesting || !browserUrl.trim() || (!!(browserClickSelector.trim() || browserTypeSelector.trim()) && !confirmSensitive)} className="rounded-lg bg-cyan-400/15 px-3 py-1.5 text-[11px] font-medium text-cyan-200 transition hover:bg-cyan-400/25 disabled:cursor-not-allowed disabled:opacity-40">{browserTesting ? 'running navigate → read → interaction…' : 'run browser check'}</button>
        <span className="text-[10px] text-gray-600">Requires extension connected, selected profile, interaction policy, and allowlisted domain.</span>
      </div>
      {browserTest && <div className={`mt-3 rounded-lg border px-3 py-2 text-[11px] ${browserTest.ok ? 'border-emerald-400/15 bg-emerald-400/[0.05] text-emerald-200' : 'border-red-400/15 bg-red-400/[0.05] text-red-300'}`}><p>{browserTest.ok ? browserTest.message : browserTest.error}</p>{browserTest.steps && <div className="mt-2 flex flex-wrap gap-2">{browserTest.steps.map((step) => <span key={step.action} className={step.ok ? 'text-emerald-300' : 'text-red-300'}>{step.ok ? '✓' : '✗'} {step.action}</span>)}</div>}</div>}
    </section>
  );

  if (!isTerminal) {
    return (
      <div className="space-y-3">
        {browserCapabilityPanel}
        <div className="text-center py-4 text-[11px] text-gray-500">runtime preview becomes available after the task completes</div>
      </div>
    );
  }

  const s = preview?.strategy;
  const r = preview?.readiness;

  const readinessBadge = r?.ok
    ? <span className="ml-auto text-emerald-500">ready ({r.signal}, {r.method})</span>
    : r
      ? <span className="ml-auto text-red-400">not ready ({r.signal})</span>
      : null;

  return (
    <div className="space-y-3">
      {browserCapabilityPanel}

      {/* Strategy info */}
      {s && (
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
          <button
            onClick={() => setShowStrategy(!showStrategy)}
            className="flex items-center gap-2 text-[11px] text-gray-400 hover:text-gray-300 transition-colors w-full"
          >
            <svg className={`h-3 w-3 transition-transform ${showStrategy ? 'rotate-90' : ''}`}
                 fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
            <span className="font-medium">{s.runtime} runtime</span>
            {s.entryFile && <span className="text-gray-600">· {s.entryFile}</span>}
            {readinessBadge}
          </button>
          {showStrategy && (
            <div className="mt-2 space-y-1 text-[10px] font-mono text-gray-500">
              <div>runtime: {s.runtime}</div>
              {s.entryFile && <div>entry: {s.entryFile}</div>}
              {s.buildCommand && <div>build: {s.buildCommand}</div>}
              {s.startCommand && <div>start: {s.startCommand}</div>}
              {s.serveRoot && <div>serveRoot: {s.serveRoot}</div>}
              <div>port: {preview?.port || 'auto'}</div>
            </div>
          )}
        </div>
      )}

      {/* Readiness result */}
      {r && (
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
          <button
            onClick={() => setShowReadiness(!showReadiness)}
            className="flex items-center gap-2 text-[11px] text-gray-400 hover:text-gray-300 transition-colors w-full"
          >
            <svg className={`h-3 w-3 transition-transform ${showReadiness ? 'rotate-90' : ''}`}
                 fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
            <span className="font-medium">
              {r.ok ? 'readiness detected' : 'readiness failed'}
            </span>
            <span className="text-gray-600">· {r.method}</span>
            <span className="text-gray-600">· {r.elapsed}ms</span>
          </button>
          {showReadiness && (
            <div className="mt-2 space-y-1 text-[10px] font-mono text-gray-500">
              <div>method: {r.method}</div>
              <div>signal: {r.signal}</div>
              <div>reason: {r.reason}</div>
              {r.evidence.length > 0 && (
                <div className="mt-2">
                  <div className="text-gray-600 mb-1">evidence:</div>
                  {r.evidence.map((line, i) => (
                    <div key={i} className="pl-2 border-l border-white/10 text-gray-600">{line}</div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Env vars detection */}
      {env && env.envVars.length > 0 && (
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
          <button
            onClick={() => setShowEnv(!showEnv)}
            className="flex items-center gap-2 text-[11px] text-gray-400 hover:text-gray-300 transition-colors w-full"
          >
            <svg className={`h-3 w-3 transition-transform ${showEnv ? 'rotate-90' : ''}`}
                 fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
            <span>{env.envVars.length} environment variable{env.envVars.length > 1 ? 's' : ''} detected</span>
          </button>
          {showEnv && (
            <div className="mt-2 space-y-2">
              {env.envVars.map((v) => (
                <div key={v} className="flex items-center gap-2">
                  <label className="text-[10px] font-mono text-gray-500 w-32 shrink-0">{v}</label>
                  <input
                    type="text" value={envValues[v] || ''}
                    onChange={(e) => setEnvValues((prev) => ({ ...prev, [v]: e.target.value }))}
                    placeholder="value for preview"
                    className="flex-1 rounded border border-white/10 bg-white/[0.03] px-2 py-1 text-[11px] text-gray-300 placeholder-gray-600 outline-none focus:border-white/20"
                  />
                </div>
              ))}
              <p className="text-[9px] text-gray-600">values are injected at runtime only, never saved to files</p>
            </div>
          )}
        </div>
      )}

      {/* Controls */}
      <div className="flex items-center gap-2">
        {preview?.running ? (
          <>
            <button
              onClick={stop}
              className="rounded-lg bg-red-500/15 text-red-400 text-[11px] font-medium px-3 py-1.5 hover:bg-red-500/25 transition"
            >
              stop
            </button>
            <span className="text-[10px] text-gray-500">
              {preview.type} · port {preview.port} · {
                Math.ceil((preview.expiresAt - Date.now()) / 60000)
              }m left
            </span>
          </>
        ) : (
          <button
            onClick={start} disabled={loading}
            className="rounded-lg bg-indigo-600 text-white text-[11px] font-medium px-3 py-1.5 hover:bg-indigo-500 transition disabled:opacity-40"
          >
            {loading ? 'analyzing + starting…' : 'launch preview'}
          </button>
        )}
        {error && <span className="text-[10px] text-red-400 max-w-xs truncate">{error}</span>}
      </div>

      {/* Preview frame */}
      {preview?.running && (
        <div className="rounded-lg border border-white/[0.06] overflow-hidden" style={{ height: '50vh' }}>
          {preview.type === 'static' ? (
            <iframe
              src={`/api/tasks/${taskId}/preview/proxy/`}
              className="w-full h-full bg-white"
              sandbox="allow-scripts allow-same-origin"
              title="preview"
            />
          ) : (
            <div className="h-full overflow-y-auto bg-[#0a0c10] p-3">
              <div className="text-[10px] uppercase tracking-widest text-gray-600 mb-2">logs</div>
              <pre className="text-[10px] font-mono text-gray-400 whitespace-pre-wrap">
                {preview.logs.join('\n') || 'waiting for output…'}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* No preview state */}
      {!preview?.running && (
        <div className="text-center py-6 text-[11px] text-gray-600">
          {env && env.envVars.length > 0
            ? 'configure environment variables above, then launch'
            : 'click launch to analyze project and start a preview'}
        </div>
      )}
    </div>
  );
}
