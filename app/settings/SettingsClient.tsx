'use client';

import { useCallback, useEffect, useState } from 'react';
import AppShell from '@/components/AppShell';
import { Button, Card, Eyebrow } from '@/components/ui';
import type { AgentInstruction, AgentMemory, AuthUser, ModelSettingsSafe } from '@/lib/types';
import ProfileStudio from './ProfileStudio';
import SkillStudio from './SkillStudio';

const MEMORY_KINDS = ['preference', 'fact', 'decision', 'constraint', 'lesson'] as const;

type ContextResponse = { instructions: AgentInstruction[]; memories: AgentMemory[] };

type ModelResponse = { model: ModelSettingsSafe | null };
type ModelTestResponse = {
  ok: true;
  message: string;
  latency_ms: number;
  model_id: string;
  base_url?: string;
  provider_reachable?: boolean;
  completion_available?: boolean;
};

async function requestContext(init?: RequestInit): Promise<ContextResponse | { ok: true }> {
  const response = await fetch('/api/agent/context', {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Request failed');
  return body;
}

async function requestModel(init?: RequestInit): Promise<ModelResponse> {
  const response = await fetch('/api/settings/model', {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Model settings request failed');
  return body;
}

async function requestModelTest(payload: Record<string, unknown>): Promise<ModelTestResponse> {
  const response = await fetch('/api/settings/model/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Model connection test failed');
  return body;
}

function statusTone(status: AgentMemory['status']): string {
  if (status === 'active') return 'bg-green-500/15 text-green-300';
  if (status === 'proposed') return 'bg-amber-500/15 text-amber-300';
  return 'bg-white/10 text-content-secondary';
}

export default function SettingsClient({ user, localMode }: { user: AuthUser; localMode: boolean }) {
  const [data, setData] = useState<ContextResponse>({ instructions: [], memories: [] });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [testingModel, setTestingModel] = useState(false);
  const [notice, setNotice] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);
  const [instructionName, setInstructionName] = useState('');
  const [instructionContent, setInstructionContent] = useState('');
  const [instructionPriority, setInstructionPriority] = useState('100');
  const [memoryContent, setMemoryContent] = useState('');
  const [memoryKind, setMemoryKind] = useState<(typeof MEMORY_KINDS)[number]>('lesson');
  const [memoryExpiresAt, setMemoryExpiresAt] = useState('');
  const [browserState, setBrowserState] = useState<DesktopBrowserState | null>(null);
  const [browserPolicy, setBrowserPolicy] = useState<DesktopBrowserPolicy | null>(null);
  const [showBrowserToken, setShowBrowserToken] = useState(false);
  const [model, setModel] = useState<ModelSettingsSafe | null>(null);
  const [modelName, setModelName] = useState('');
  const [modelBaseUrl, setModelBaseUrl] = useState('');
  const [modelId, setModelId] = useState('');
  const [modelApiKey, setModelApiKey] = useState('');
  const [modelTemperature, setModelTemperature] = useState('0.7');
  const [modelMaxTokens, setModelMaxTokens] = useState('4000');
  const [modelContextWindow, setModelContextWindow] = useState('128000');
  const [modelCompactThreshold, setModelCompactThreshold] = useState('80');
  const [updateState, setUpdateState] = useState<DesktopUpdateState | null>(null);
  const [updateSettings, setUpdateSettings] = useState<DesktopUpdateSettings | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await requestContext() as ContextResponse;
      setData(result);
      if (localMode) {
        const modelResult = await requestModel();
        setModel(modelResult.model);
        if (modelResult.model) {
          setModelName(modelResult.model.name);
          setModelBaseUrl(modelResult.model.base_url);
          setModelId(modelResult.model.model_id);
          setModelTemperature(String(modelResult.model.temperature));
          setModelMaxTokens(String(modelResult.model.max_tokens));
          setModelContextWindow(String(modelResult.model.context_window));
          setModelCompactThreshold(String(modelResult.model.auto_compact_threshold));
        }
      }
    } catch (err) {
      setNotice({ type: 'error', text: err instanceof Error ? err.message : 'Could not load Prompt Studio.' });
    } finally {
      setLoading(false);
    }
  }, [localMode]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const desktop = window.xeoDesktop;
    if (!desktop) return;
    let active = true;
    const refresh = () => desktop.getBrowserState().then((state) => {
      if (!active) return;
      setBrowserState(state);
      setBrowserPolicy((current) => current ?? state.browserPolicy);
    }).catch((error) => console.warn('[desktop] browser state unavailable', error));
    refresh();
    const timer = window.setInterval(refresh, 3000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    const desktop = window.xeoDesktop;
    if (!desktop || !localMode) return;
    let active = true;
    Promise.all([desktop.getUpdateState(), desktop.getUpdateSettings()])
      .then(([state, settings]) => { if (active) { setUpdateState(state); setUpdateSettings(settings); } })
      .catch((error) => setNotice({ type: 'error', text: error instanceof Error ? error.message : 'Could not load update settings.' }));
    const unsubscribe = window.xeoDesktopEvents?.onUpdateStatus((state) => { if (active) setUpdateState(state); });
    return () => { active = false; unsubscribe?.(); };
  }, [localMode]);

  const runMutation = async (payload: Record<string, unknown>, success: string) => {
    setBusy(true);
    setNotice(null);
    try {
      await requestContext({ method: 'POST', body: JSON.stringify(payload) });
      setNotice({ type: 'ok', text: success });
      await load();
    } catch (err) {
      setNotice({ type: 'error', text: err instanceof Error ? err.message : 'Action failed.' });
    } finally {
      setBusy(false);
    }
  };

  const patch = async (payload: Record<string, unknown>, success: string) => {
    setBusy(true);
    setNotice(null);
    try {
      await requestContext({ method: 'PATCH', body: JSON.stringify(payload) });
      setNotice({ type: 'ok', text: success });
      await load();
    } catch (err) {
      setNotice({ type: 'error', text: err instanceof Error ? err.message : 'Update failed.' });
    } finally {
      setBusy(false);
    }
  };

  const refreshUpdates = async () => {
    if (!window.xeoDesktop) return;
    try {
      setUpdateState(await window.xeoDesktop.checkForUpdate());
    } catch (err) {
      setNotice({ type: 'error', text: err instanceof Error ? err.message : 'Could not check for updates.' });
    }
  };

  const downloadUpdate = async () => {
    if (!window.xeoDesktop) return;
    try {
      setUpdateState(await window.xeoDesktop.downloadUpdate());
    } catch (err) {
      setNotice({ type: 'error', text: err instanceof Error ? err.message : 'Could not download the update.' });
    }
  };

  const installUpdate = async () => {
    if (!window.xeoDesktop) return;
    try {
      setUpdateState(await window.xeoDesktop.installUpdate());
    } catch (err) {
      setNotice({ type: 'error', text: err instanceof Error ? err.message : 'Could not restart for the update.' });
    }
  };

  const saveUpdateSettings = async (patch: Partial<DesktopUpdateSettings>) => {
    if (!window.xeoDesktop || !updateSettings) return;
    try {
      setUpdateSettings(await window.xeoDesktop.setUpdateSettings({ ...updateSettings, ...patch }));
      setNotice({ type: 'ok', text: 'Update preferences saved locally.' });
    } catch (err) {
      setNotice({ type: 'error', text: err instanceof Error ? err.message : 'Could not save update preferences.' });
    }
  };

  const saveBrowserPolicy = async (patch: Partial<DesktopBrowserPolicy>) => {
    if (!window.xeoDesktop || !browserPolicy) return;
    try {
      const state = await window.xeoDesktop.setBrowserPolicy({ ...browserPolicy, ...patch });
      setBrowserState(state);
      setBrowserPolicy(state.browserPolicy);
      setNotice({ type: 'ok', text: 'Browser safety policy saved locally.' });
    } catch (err) {
      setNotice({ type: 'error', text: err instanceof Error ? err.message : 'Could not save browser policy.' });
    }
  };

  const testModelConnection = async () => {
    setTestingModel(true);
    setNotice(null);
    try {
      const result = await requestModelTest({
        baseUrl: modelBaseUrl.trim(),
        modelId: modelId.trim(),
        ...(modelApiKey.trim() ? { apiKey: modelApiKey.trim() } : {}),
      });
      setNotice({ type: 'ok', text: `${result.message} (${result.latency_ms} ms).` });
    } catch (err) {
      setNotice({ type: 'error', text: err instanceof Error ? err.message : 'Model connection test failed.' });
    } finally {
      setTestingModel(false);
    }
  };

  const saveModel = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      const response = await requestModel({
        method: 'PUT',
        body: JSON.stringify({
          name: modelName.trim(),
          baseUrl: modelBaseUrl.trim(),
          modelId: modelId.trim(),
          ...(modelApiKey.trim() ? { apiKey: modelApiKey.trim() } : {}),
          temperature: Number(modelTemperature),
          maxTokens: Number(modelMaxTokens),
          contextWindow: Number(modelContextWindow),
          autoCompactThreshold: Number(modelCompactThreshold),
        }),
      });
      setModel(response.model);
      setModelApiKey('');
      setNotice({ type: 'ok', text: 'Local model settings saved. New runs will use this configuration.' });
    } catch (err) {
      setNotice({ type: 'error', text: err instanceof Error ? err.message : 'Could not save model settings.' });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (type: 'instruction' | 'memory', id: string) => {
    if (!window.confirm('Remove this item from your agent context?')) return;
    setBusy(true);
    try {
      await requestContext({ method: 'DELETE', body: JSON.stringify({ type, id }) });
      setNotice({ type: 'ok', text: 'Removed.' });
      await load();
    } catch (err) {
      setNotice({ type: 'error', text: err instanceof Error ? err.message : 'Delete failed.' });
    } finally {
      setBusy(false);
    }
  };

  const addInstruction = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!instructionName.trim() || !instructionContent.trim()) return;
    await runMutation({
      type: 'instruction',
      scope: 'global',
      name: instructionName,
      content: instructionContent,
      priority: Number(instructionPriority) || 100,
    }, 'Instruction pinned globally.');
    setInstructionName('');
    setInstructionContent('');
  };

  const addMemory = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!memoryContent.trim()) return;
    await runMutation({
      type: 'memory',
      scope: 'global',
      kind: memoryKind,
      content: memoryContent,
      status: 'active',
      confidence: 1,
      pinned: true,
      expiresAt: memoryExpiresAt ? new Date(memoryExpiresAt).toISOString() : null,
    }, 'Memory pinned globally.');
    setMemoryContent('');
    setMemoryExpiresAt('');
  };

  return (
    <AppShell user={user} localMode={localMode} title={localMode ? 'Control Center' : 'Workspace Control Center'} subtitle={localMode ? 'Shape how Xeo works locally—without accounts, billing, or source-code edits.' : 'Shape how agents think, what they remember, and which workflows they can reuse—without editing source code.'}>
      <div className="space-y-8">
        <header className="max-w-3xl">
          <Eyebrow>{localMode ? 'Control Center' : 'Agent controls'}</Eyebrow>
          <h2 className="mt-3 text-display font-semibold tracking-tight text-content-primary sm:text-3xl">Make Xeo work the way you expect.</h2>
          <p className="mt-3 text-ui leading-6 text-content-secondary">Configure the model, browser permissions, reusable instructions, and memory from one clear workspace. Changes are visible, local where applicable, and never require source-code edits.</p>
          <div className="mt-5 flex flex-wrap gap-2 text-meta"><span className="rounded-full border border-signal-plan/15 bg-signal-plan/06 px-2.5 py-1 text-signal-plan/80">Model</span><span className="rounded-full border border-signal-run/15 bg-signal-run/06 px-2.5 py-1 text-signal-run/80">Browser</span><span className="rounded-full border border-signal-pass/15 bg-signal-pass/06 px-2.5 py-1 text-signal-pass/80">Memory</span><span className="rounded-full border border-line bg-ink-700/60 px-2.5 py-1 text-content-secondary">Updates</span></div>
        </header>

        {notice && (
          <div className={`mb-6 rounded-control border px-4 py-3 text-ui ${notice.type === 'ok' ? 'border-green-500/20 bg-green-500/10 text-green-300' : 'border-red-500/20 bg-signal-fail/10 text-signal-fail'}`}>
            {notice.text}
          </div>
        )}

        {/* Model configuration is reachable on BOTH surfaces. Gating it behind
            localMode hid the only path to configure a provider in web mode, which
            left the agent permanently unrunnable there (AGENTS.md rule 4). */}
        <section className="rounded-modal border border-signal-plan/10 bg-signal-plan/035 p-5 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <Eyebrow>Model</Eyebrow>
                <h2 className="mt-2 font-semibold text-content-primary">Choose how Xeo thinks</h2>
                <p className="mt-2 max-w-2xl text-meta leading-5 text-content-secondary">Connect an OpenAI-compatible provider. The key is stored server-side, never returned to the browser, and shown only as a masked status. One model configuration is shared by every run.</p>
              </div>
              <span className={`rounded-full px-2.5 py-1 text-micro ${model?.api_key_set ? 'bg-signal-pass/10 text-signal-pass' : 'bg-signal-gate/10 text-amber-300'}`}>{model?.api_key_issue === 'placeholder' ? 'replace placeholder key' : model?.api_key_set ? 'provider configured' : 'setup required'}</span>
            </div>
            <form onSubmit={saveModel} className="mt-5 space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                <label className="space-y-1.5"><span className="text-micro uppercase tracking-[0.14em] text-content-muted">Display name</span><input value={modelName} onChange={(e) => setModelName(e.target.value)} placeholder="Local model" className="w-full rounded-md border border-line bg-black/10 px-3 py-2 text-ui outline-none placeholder:text-content-muted focus:border-signal-plan/50" /></label>
                <label className="space-y-1.5"><span className="text-micro uppercase tracking-[0.14em] text-content-muted">Model ID</span><input value={modelId} onChange={(e) => setModelId(e.target.value)} placeholder="gpt-4o-mini or local-model" className="w-full rounded-md border border-line bg-black/10 px-3 py-2 text-ui outline-none placeholder:text-content-muted focus:border-signal-plan/50" /></label>
              </div>
              <label className="block space-y-1.5"><span className="text-micro uppercase tracking-[0.14em] text-content-muted">OpenAI-compatible base URL</span><input value={modelBaseUrl} onChange={(e) => setModelBaseUrl(e.target.value)} type="url" placeholder="http://127.0.0.1:1234/v1" className="w-full rounded-md border border-line bg-black/10 px-3 py-2 text-ui outline-none placeholder:text-content-muted focus:border-signal-plan/50" /></label>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <label className="space-y-1.5"><span className="text-micro uppercase tracking-[0.14em] text-content-muted">API key</span><input value={modelApiKey} onChange={(e) => setModelApiKey(e.target.value)} type="password" placeholder={model?.api_key_set ? 'Leave unchanged' : 'Required by provider'} className="w-full rounded-md border border-line bg-black/10 px-3 py-2 text-ui outline-none placeholder:text-content-muted focus:border-signal-plan/50" /></label>
                <label className="space-y-1.5"><span className="text-micro uppercase tracking-[0.14em] text-content-muted">Temperature</span><input value={modelTemperature} onChange={(e) => setModelTemperature(e.target.value)} type="number" min="0" max="2" step="0.1" className="w-full rounded-md border border-line bg-black/10 px-3 py-2 text-ui outline-none focus:border-signal-plan/50" /></label>
                <label className="space-y-1.5"><span className="text-micro uppercase tracking-[0.14em] text-content-muted">Max output tokens</span><input value={modelMaxTokens} onChange={(e) => setModelMaxTokens(e.target.value)} type="number" min="256" max="200000" className="w-full rounded-md border border-line bg-black/10 px-3 py-2 text-ui outline-none focus:border-signal-plan/50" /></label>
                <label className="space-y-1.5"><span className="text-micro uppercase tracking-[0.14em] text-content-muted">Context compact at %</span><input value={modelCompactThreshold} onChange={(e) => setModelCompactThreshold(e.target.value)} type="number" min="10" max="95" className="w-full rounded-md border border-line bg-black/10 px-3 py-2 text-ui outline-none focus:border-signal-plan/50" /></label>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-meta leading-5 text-content-muted">Context window: <span className="text-content-secondary">{modelContextWindow || '128000'}</span> tokens. The model configuration is global to this workspace. Use at least 256 output tokens; reasoning models can reject tiny budgets. Test the connection before saving if you are unsure about the key or model ID.</p>
                <div className="flex items-center gap-2"><input value={modelContextWindow} onChange={(e) => setModelContextWindow(e.target.value)} aria-label="Context window" type="number" min="1024" max="10000000" className="w-32 rounded-md border border-line bg-black/10 px-3 py-2 text-ui outline-none focus:border-signal-plan/50" /><Button type="button" variant="ghost" disabled={testingModel || !modelBaseUrl.trim() || !modelId.trim()} onClick={testModelConnection}>{testingModel ? 'Testing…' : 'Test connection'}</Button><Button type="submit" disabled={busy || !modelName.trim() || !modelBaseUrl.trim() || !modelId.trim()}>Save model</Button></div>
              </div>
            </form>
        </section>

        {localMode && (
          <section className="rounded-modal border border-signal-pass/10 bg-signal-pass/03 p-5 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <Eyebrow>Application updates</Eyebrow>
                <h2 className="mt-2 font-semibold text-content-primary">Keep Xeo Forge current</h2>
                <p className="mt-2 max-w-2xl text-meta leading-5 text-content-secondary">Stable is recommended for everyday use. Preview receives prerelease builds for testing. Updates are checked on a deliberate schedule, downloaded separately, and installed only when you choose to restart. Your local database, project path, browser profiles, and settings remain in the user data directory.</p>
              </div>
              <span className={`rounded-full px-2.5 py-1 text-micro ${updateState?.status === 'error' ? 'bg-signal-fail/10 text-signal-fail' : updateState?.status === 'downloaded' ? 'bg-signal-pass/10 text-signal-pass' : 'bg-ink-700 text-content-secondary'}`}>{updateState?.status || 'loading'}</span>
            </div>
            <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_auto]">
              <div className="rounded-panel border border-line-subtle bg-black/10 p-4 text-meta leading-5 text-content-secondary">
                <p className="text-content-primary">Current version <span className="font-mono text-signal-pass">{updateState?.currentVersion || '—'}</span>{updateState?.version ? <> · available <span className="font-mono text-signal-run">{updateState.version}</span></> : ''}</p>
                <p className="mt-1">{updateState?.message || 'No update check has completed in this session.'}</p>
                {updateState?.status === 'downloading' && <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-signal-run transition-all" style={{ width: `${updateState.percent}%` }} /></div>}
                {updateState?.lastCheckedAt && <p className="mt-2 text-meta text-content-muted">Last checked {new Date(updateState.lastCheckedAt).toLocaleString()}</p>}
                {updateState?.lastError && <p className="mt-2 text-meta text-signal-fail/80">{updateState.lastError}</p>}
              </div>
              <div className="flex flex-wrap items-start justify-end gap-2">
                <Button variant="ghost" disabled={updateState?.status === 'checking' || updateState?.status === 'downloading'} onClick={refreshUpdates}>Check now</Button>
                {updateState?.status === 'available' && <Button onClick={downloadUpdate}>Download</Button>}
                {updateState?.status === 'downloaded' && <Button onClick={installUpdate}>Restart and install</Button>}
              </div>
            </div>
            {updateSettings && (
              <div className="mt-4 flex flex-wrap items-center gap-4 border-t border-line-subtle pt-4 text-meta text-content-secondary">
                <label className="flex items-center gap-2"><input type="checkbox" checked={updateSettings.autoCheck} onChange={(e) => saveUpdateSettings({ autoCheck: e.target.checked })} /> Automatic checks</label>
                <label className="flex items-center gap-2">Release channel <select aria-label="Release channel" value={updateSettings.channel} onChange={(e) => saveUpdateSettings({ channel: e.target.value as DesktopUpdateSettings['channel'] })} className="rounded-md border border-line bg-black/20 px-2 py-1.5 text-meta text-content-primary"><option value="latest">Stable</option><option value="beta">Preview</option></select></label>
                <label className="flex items-center gap-2">Every <input type="number" min="1" max="168" value={updateSettings.intervalHours} onChange={(e) => setUpdateSettings({ ...updateSettings, intervalHours: Number(e.target.value) || 6 })} onBlur={() => saveUpdateSettings({ intervalHours: updateSettings.intervalHours })} className="w-16 rounded-md border border-line bg-black/20 px-2 py-1.5 text-meta text-content-primary" /> hours</label>
              </div>
            )}
          </section>
        )}

        <section className="rounded-modal border border-signal-run/10 bg-signal-run/035 p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <Eyebrow>Optional local capability</Eyebrow>
              <h2 className="mt-2 font-semibold text-content-primary">User-controlled browser</h2>
              <p className="mt-2 max-w-2xl text-meta leading-5 text-content-secondary">Install the extension in the browser profile you want Xeo Forge to use. The selected local profile remains attached to Work until you change it; the bridge never silently switches to another browser.</p>
            </div>
            <span className={`rounded-full px-2.5 py-1 text-micro ${browserState?.connected ? 'bg-signal-pass/10 text-signal-pass' : browserState?.selection === 'selected_disconnected' ? 'bg-signal-gate/10 text-amber-300' : 'bg-ink-700 text-content-muted'}`}>{browserState?.connected ? 'selected · connected' : browserState?.selection === 'selected_disconnected' ? 'selected · disconnected' : 'connect a profile'}</span>
          </div>
          <div className="mt-5 rounded-panel border border-signal-run/10 bg-signal-run/025 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-ui font-medium text-content-primary">Install the browser extension</p>
                <p className="mt-1 max-w-2xl text-meta leading-5 text-content-muted">The extension is loaded locally and connects only to Xeo Forge on <code className="text-signal-run">127.0.0.1</code>. It does not upload cookies or browsing content.</p>
              </div>
              <Button variant="ghost" disabled={!localMode || !window.xeoDesktop} onClick={() => window.xeoDesktop?.openBrowserExtension().catch((error) => setNotice({ type: 'error', text: error instanceof Error ? error.message : 'Could not open extension folder.' }))}>Open extension folder</Button>
            </div>
            <ol className="mt-4 grid gap-3 text-meta leading-5 text-content-secondary sm:grid-cols-2">
              <li className="flex gap-3"><span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-signal-run/10 text-micro font-semibold text-signal-run">1</span><span>Click <strong className="font-medium text-content-primary">Open extension folder</strong>, or locate <code className="text-signal-run">desktop/browser-extension</code> in the Xeo Forge project.</span></li>
              <li className="flex gap-3"><span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-signal-run/10 text-micro font-semibold text-signal-run">2</span><span>In Chrome or Chromium, open <code className="text-signal-run">chrome://extensions</code> and turn on <strong className="font-medium text-content-primary">Developer mode</strong>.</span></li>
              <li className="flex gap-3"><span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-signal-run/10 text-micro font-semibold text-signal-run">3</span><span>Choose <strong className="font-medium text-content-primary">Load unpacked</strong>, then select the <code className="text-signal-run">browser-extension</code> folder itself, not its parent folder.</span></li>
              <li className="flex gap-3"><span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-signal-run/10 text-micro font-semibold text-signal-run">4</span><span>Open the extension’s <strong className="font-medium text-content-primary">Options</strong>, paste the token shown below, keep port <code className="text-signal-run">4321</code>, name the profile, then click <strong className="font-medium text-content-primary">Save and connect</strong>.</span></li>
            </ol>
            <p className="mt-4 border-t border-line-subtle pt-3 text-meta leading-5 text-content-muted">After connecting, return here and select the profile. For navigation, clicking, or typing, also add the domain to the allowlist and enable the interaction policy below.</p>
          </div>

          {browserState && (
            <div className="mt-5 space-y-4">
              {browserPolicy && (
                <div className="rounded-panel border border-signal-gate/10 bg-signal-gate/03 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-ui font-medium text-content-primary">Interaction policy</p>
                      <p className="mt-1 max-w-2xl text-meta leading-5 text-content-muted">Read access stays available by default. Navigation, clicks, and typing require this local policy, an allowed domain, and an explicit confirmation for sensitive actions.</p>
                    </div>
                    <span className={`rounded-full px-2 py-1 text-micro ${browserPolicy.interactionEnabled ? 'bg-signal-gate/10 text-signal-gate' : 'bg-ink-700 text-content-muted'}`}>{browserPolicy.interactionEnabled ? 'interaction enabled' : 'read-only mode'}</span>
                  </div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-3">
                    <label className="flex items-start gap-2 text-meta text-content-secondary"><input type="checkbox" checked={browserPolicy.interactionEnabled} onChange={(e) => setBrowserPolicy({ ...browserPolicy, interactionEnabled: e.target.checked })} /> <span><strong className="font-medium text-content-primary">Allow interaction</strong><span className="mt-1 block text-content-muted">Enable navigate, click, and type after saving domains.</span></span></label>
                    <label className="flex items-start gap-2 text-meta text-content-secondary"><input type="checkbox" checked={browserPolicy.redactSensitiveData} onChange={(e) => setBrowserPolicy({ ...browserPolicy, redactSensitiveData: e.target.checked })} /> <span><strong className="font-medium text-content-primary">Redact page data</strong><span className="mt-1 block text-content-muted">Mask emails, cards, phones, and token-like strings in text reads.</span></span></label>
                    <label className="flex items-start gap-2 text-meta text-content-secondary"><input type="checkbox" checked={browserPolicy.allowSensitiveActions} onChange={(e) => setBrowserPolicy({ ...browserPolicy, allowSensitiveActions: e.target.checked })} /> <span><strong className="font-medium text-content-primary">Allow sensitive actions</strong><span className="mt-1 block text-content-muted">Still requires explicit confirmation on each click or type call.</span></span></label>
                  </div>
                  <label className="mt-4 block space-y-1.5"><span className="text-micro uppercase tracking-[0.14em] text-content-muted">Allowed domains · one per line</span><textarea value={browserPolicy.allowedDomains.join('\\n')} onChange={(e) => setBrowserPolicy({ ...browserPolicy, allowedDomains: e.target.value.split(/\\r?\\n|,/).map((value) => value.trim()).filter(Boolean) })} rows={3} placeholder="example.com\\nlocalhost" className="w-full rounded-md border border-line bg-black/10 px-3 py-2 text-meta text-content-primary outline-none placeholder:text-content-faint focus:border-signal-gate/50" /></label>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3"><p className="text-meta leading-5 text-content-muted">Subdomains are included. An empty allowlist keeps all write actions blocked.</p><Button variant="ghost" onClick={() => saveBrowserPolicy(browserPolicy)}>Save safety policy</Button></div>
                </div>
              )}
              <div className="grid gap-4 lg:grid-cols-[1fr_auto]">
                <div className="rounded-panel border border-line-subtle bg-black/10 p-4">
                  <p className="text-micro uppercase tracking-[0.16em] text-content-muted">Local extension token · port {browserState.port}</p>
                  <code className="mt-2 block overflow-hidden text-ellipsis whitespace-nowrap text-meta text-signal-run/80">{showBrowserToken ? browserState.token : '••••••••••••••••••••••••••••••••'}</code>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button variant="ghost" onClick={() => setShowBrowserToken((value) => !value)}>{showBrowserToken ? 'Hide token' : 'Reveal token'}</Button>
                    <Button variant="ghost" disabled={!browserState.token} onClick={() => browserState.token && navigator.clipboard.writeText(browserState.token)}>Copy token</Button>
                    <Button variant="ghost" onClick={() => window.xeoDesktop?.openBrowserExtension().catch((error) => setNotice({ type: 'error', text: error instanceof Error ? error.message : 'Could not open extension folder.' }))}>Open extension folder</Button>
                  </div>
                </div>
                <div className="max-w-xs text-meta leading-5 text-content-muted"><p className="text-content-secondary">Read access is the default.</p><p className="mt-1">Navigation, clicks, typing, and form submission remain blocked until a separate interaction policy is granted.</p></div>
              </div>
              {browserState.profiles.length === 0 ? (
                <div className="rounded-panel border border-dashed border-line p-4 text-ui text-content-muted">No browser profile is connected yet. Load the unpacked extension, paste the token, and give this profile a name.</div>
              ) : (
                <div className="grid gap-3 md:grid-cols-2">
                  {browserState.profiles.map((profile) => {
                    const selected = profile.browserId === browserState.selectedBrowserId;
                    return (
                      <div key={profile.browserId} className={`rounded-panel border p-4 ${selected ? 'border-signal-run/30 bg-signal-run/06' : 'border-line-subtle bg-black/10'}`}>
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-ui font-medium text-content-primary">{profile.profileName}</p>
                            <p className="mt-1 text-meta text-content-muted">{profile.browserName} · {profile.connected ? 'connected' : 'disconnected'}</p>
                          </div>
                          {selected && <span className="rounded-full bg-signal-run/10 px-2 py-1 text-micro text-signal-run">selected for Work</span>}
                        </div>
                        <p className="mt-3 truncate text-meta text-content-secondary">{profile.tab?.title || 'No active tab reported'}</p>
                        <p className="mt-1 truncate text-meta text-content-muted">{profile.tab?.url || '—'}</p>
                        <Button variant="ghost" className="mt-3" disabled={!profile.connected || selected} onClick={() => window.xeoDesktop?.selectBrowser(profile.browserId).then(setBrowserState).catch((error) => setNotice({ type: 'error', text: error instanceof Error ? error.message : 'Could not select browser profile.' }))}>{selected ? 'Using this profile' : 'Use for Work'}</Button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </section>

        <ProfileStudio />
        <SkillStudio />

        <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <section className="space-y-6">
            <Card>
              <div className="mb-5 flex items-start justify-between gap-4">
                <div>
                  <h2 className="font-semibold">Pinned instructions</h2>
                  <p className="mt-1 text-meta leading-5 text-content-muted">Reusable preferences applied to every task. They never grant new permissions or bypass approval.</p>
                </div>
                <span className="rounded-full bg-blue-500/10 px-2.5 py-1 text-micro text-blue-300">{data.instructions.length} active layers</span>
              </div>
              <form onSubmit={addInstruction} className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-[1fr_110px]">
                  <input value={instructionName} onChange={(e) => setInstructionName(e.target.value)} placeholder="Name, e.g. Product voice" className="rounded-md border border-line bg-ink-700/60 px-3 py-2 text-ui outline-none placeholder:text-content-muted focus:border-blue-400/50" />
                  <input value={instructionPriority} onChange={(e) => setInstructionPriority(e.target.value)} type="number" min="0" max="1000" placeholder="Priority" className="rounded-md border border-line bg-ink-700/60 px-3 py-2 text-ui outline-none placeholder:text-content-muted focus:border-blue-400/50" />
                </div>
                <textarea value={instructionContent} onChange={(e) => setInstructionContent(e.target.value)} placeholder="Always use concise English UI copy..." rows={4} className="w-full resize-y rounded-md border border-line bg-ink-700/60 px-3 py-2 text-ui leading-6 outline-none placeholder:text-content-muted focus:border-blue-400/50" />
                <Button type="submit" disabled={busy || !instructionName.trim() || !instructionContent.trim()}>Pin instruction</Button>
              </form>
            </Card>

            <Card>
              <div className="mb-4 flex items-center justify-between gap-4">
                <div>
                  <h2 className="font-semibold">Current instructions</h2>
                  <p className="mt-1 text-meta text-content-muted">Edit or disable a layer without touching the repository.</p>
                </div>
              </div>
              {loading ? <p className="text-ui text-content-muted">Loading…</p> : data.instructions.length === 0 ? <p className="rounded-md border border-dashed border-line p-4 text-ui text-content-muted">No pinned instructions yet.</p> : (
                <div className="space-y-3">
                  {data.instructions.map((instruction) => (
                    <div key={instruction.id} className="rounded-control border border-line-subtle bg-ink-700/60 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div><p className="text-ui font-medium">{instruction.name}</p><p className="mt-1 text-meta text-content-muted">Priority {instruction.priority} · v{instruction.version}</p></div>
                        <span className={`rounded-full px-2 py-1 text-micro ${instruction.enabled ? 'bg-green-500/15 text-green-300' : 'bg-white/10 text-content-muted'}`}>{instruction.enabled ? 'enabled' : 'disabled'}</span>
                      </div>
                      <p className="mt-3 whitespace-pre-wrap text-ui leading-6 text-content-secondary">{instruction.content}</p>
                      <div className="mt-3 flex gap-2">
                        <Button variant="ghost" disabled={busy} onClick={() => patch({ type: 'instruction', id: instruction.id, enabled: !instruction.enabled }, instruction.enabled ? 'Instruction disabled.' : 'Instruction enabled.')}>{instruction.enabled ? 'Disable' : 'Enable'}</Button>
                        <Button variant="ghost" disabled={busy} onClick={() => remove('instruction', instruction.id)}>Delete</Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </section>

          <section className="space-y-6">
            <Card>
              <div className="mb-5">
                <h2 className="font-semibold">Persistent memory</h2>
                <p className="mt-1 text-meta leading-5 text-content-muted">The agent proposes memories after verified runs. You decide what becomes active context.</p>
              </div>
              <form onSubmit={addMemory} className="space-y-3">
                <select value={memoryKind} onChange={(e) => setMemoryKind(e.target.value as (typeof MEMORY_KINDS)[number])} className="w-full rounded-md border border-line bg-[#111419] px-3 py-2 text-ui text-content-secondary outline-none focus:border-blue-400/50">
                  {MEMORY_KINDS.map((kind) => <option key={kind} value={kind}>{kind}</option>)}
                </select>
                <textarea value={memoryContent} onChange={(e) => setMemoryContent(e.target.value)} placeholder="The project uses a dark, dense developer dashboard..." rows={4} className="w-full resize-y rounded-md border border-line bg-ink-700/60 px-3 py-2 text-ui leading-6 outline-none placeholder:text-content-muted focus:border-blue-400/50" />
                <label className="block text-meta text-content-muted">Optional expiry <input type="datetime-local" value={memoryExpiresAt} onChange={(e) => setMemoryExpiresAt(e.target.value)} className="mt-1 w-full rounded-md border border-line bg-[#111419] px-3 py-2 text-ui text-content-secondary outline-none focus:border-blue-400/50" /></label>
                <p className="text-meta leading-5 text-content-muted">Use expiry for temporary project facts. Expired memories stay in the inbox but are excluded from future agent context.</p>
                <Button type="submit" disabled={busy || !memoryContent.trim()}>Pin memory</Button>
              </form>
            </Card>

            <Card>
              <div className="mb-4 flex items-center justify-between gap-4">
                <div><h2 className="font-semibold">Memory inbox</h2><p className="mt-1 text-meta text-content-muted">Review proposals before they influence future runs.</p></div>
                <span className="rounded-full bg-amber-500/10 px-2.5 py-1 text-micro text-amber-300">{data.memories.filter((m) => m.status === 'proposed').length} proposed</span>
              </div>
              {loading ? <p className="text-ui text-content-muted">Loading…</p> : data.memories.length === 0 ? <p className="rounded-md border border-dashed border-line p-4 text-ui text-content-muted">No memories yet. Complete a verified task to generate proposals.</p> : (
                <div className="space-y-3">
                  {data.memories.map((memory) => (
                    <div key={memory.id} className="rounded-control border border-line-subtle bg-ink-700/60 p-4">
                      <div className="flex items-center justify-between gap-3"><span className="text-micro uppercase tracking-wider text-content-muted">{memory.kind}</span><span className={`rounded-full px-2 py-1 text-micro ${statusTone(memory.status)}`}>{memory.status}</span></div>
                      <p className="mt-3 text-ui leading-6 text-content-secondary">{memory.content}</p>
                      <p className="mt-2 text-meta text-content-muted">{memory.scope} · {Math.round(memory.confidence * 100)}% confidence{memory.pinned ? ' · pinned' : ''}{memory.expires_at ? ` · expires ${new Date(memory.expires_at).toLocaleDateString()}` : ''}</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {memory.status !== 'active' && <Button variant="ghost" disabled={busy} onClick={() => patch({ type: 'memory', id: memory.id, status: 'active', pinned: true }, 'Memory activated.')}>Activate</Button>}
                        {memory.status === 'active' && <Button variant="ghost" disabled={busy} onClick={() => patch({ type: 'memory', id: memory.id, status: 'archived', pinned: false }, 'Memory archived.')}>Archive</Button>}
                        <Button variant="ghost" disabled={busy} onClick={() => remove('memory', memory.id)}>Delete</Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </section>
        </div>

        <p className="pt-2 text-meta leading-5 text-content-muted">{localMode ? 'Local Owner workspace. Instructions, memories, browser profiles, and reusable roles stay on this device.' : `Signed in as ${user.displayName || user.email || 'user'}. Task-scoped instructions, memories, and reusable profiles can be managed from the task control surface and dashboard.`}</p>
      </div>
    </AppShell>
  );
}
