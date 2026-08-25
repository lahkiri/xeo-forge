'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ProviderCatalog, ProviderModel } from '@/lib/types';
import { Alert, Button, cx } from '@/components/ui';

type Notice = { tone: 'ok' | 'error'; text: string } | null;
type RemoteModel = { id: string; name: string };

const emptyCatalog: ProviderCatalog = { providers: [], active_provider_id: null, active_model_id: null };

async function requestCatalog(init?: RequestInit): Promise<ProviderCatalog> {
  const response = await fetch('/api/providers', { ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Provider request failed.');
  return (body.catalog ?? body) as ProviderCatalog;
}

async function requestProvider(id: string, payload: Record<string, unknown>): Promise<ProviderCatalog> {
  const response = await fetch(`/api/providers/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Provider update failed.');
  return body.catalog as ProviderCatalog;
}

async function requestDeleteProvider(id: string): Promise<ProviderCatalog> {
  const response = await fetch(`/api/providers/${id}`, { method: 'DELETE' });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Provider deletion failed.');
  return body.catalog as ProviderCatalog;
}

async function requestDeleteModel(providerId: string, modelId: string): Promise<ProviderCatalog> {
  const response = await fetch(`/api/providers/${providerId}/models/${modelId}`, { method: 'DELETE' });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Model deletion failed.');
  return body.catalog as ProviderCatalog;
}

async function requestModel(providerId: string, modelId: string, payload: Record<string, unknown>): Promise<ProviderCatalog> {
  const response = await fetch(`/api/providers/${providerId}/models/${modelId}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Model update failed.');
  return body.catalog as ProviderCatalog;
}

export default function ProvidersManager() {
  const [catalog, setCatalog] = useState<ProviderCatalog>(emptyCatalog);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showProviderForm, setShowProviderForm] = useState(false);
  const [showModelForm, setShowModelForm] = useState(false);
  const [showImportModels, setShowImportModels] = useState(false);
  const [remoteModels, setRemoteModels] = useState<RemoteModel[]>([]);
  const [selectedRemoteIds, setSelectedRemoteIds] = useState<string[]>([]);
  const [importModelsBusy, setImportModelsBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [providerForm, setProviderForm] = useState({ name: '', slug: '', baseUrl: 'https://api.openai.com/v1', apiKey: '' });
  const [modelForm, setModelForm] = useState({ name: '', modelId: '', temperature: '0.7', maxTokens: '4000', contextWindow: '128000' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = await requestCatalog();
      setCatalog(next);
      setSelectedId((current) => current || next.providers[0]?.id || '');
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Could not load providers.' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const selectedProvider = useMemo(() => catalog.providers.find((provider) => provider.id === selectedId) ?? catalog.providers[0], [catalog.providers, selectedId]);

  async function mutate(work: () => Promise<ProviderCatalog>, success: string) {
    setBusy(true);
    setNotice(null);
    try {
      const next = await work();
      setCatalog(next);
      setNotice({ tone: 'ok', text: success });
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Request failed.' });
    } finally {
      setBusy(false);
    }
  }

  async function addProvider(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch('/api/providers', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(providerForm) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Could not add provider.');
      setCatalog(body.catalog);
      setSelectedId(body.provider.id);
      setProviderForm({ name: '', slug: '', baseUrl: 'https://api.openai.com/v1', apiKey: '' });
      setShowProviderForm(false);
      setNotice({ tone: 'ok', text: 'Provider added. Add one or more models to make it selectable.' });
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Could not add provider.' });
    } finally {
      setBusy(false);
    }
  }

  async function discoverModels() {
    if (!selectedProvider) return;
    setShowImportModels(true); setImportModelsBusy(true); setNotice(null); setRemoteModels([]); setSelectedRemoteIds([]);
    try {
      const response = await fetch(`/api/providers/${selectedProvider.id}/models/import`);
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Could not load models from this provider.');
      setRemoteModels(body.models || []);
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Could not load models from this provider.' });
    } finally { setImportModelsBusy(false); }
  }

  async function importSelectedModels(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedProvider || selectedRemoteIds.length === 0) return;
    setImportModelsBusy(true); setNotice(null);
    try {
      const response = await fetch(`/api/providers/${selectedProvider.id}/models/import`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ models: selectedRemoteIds.map((modelId) => ({ modelId, name: remoteModels.find((model) => model.id === modelId)?.name })) }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Could not import provider models.');
      setCatalog(body.catalog); setRemoteModels([]); setSelectedRemoteIds([]); setShowImportModels(false);
      setNotice({ tone: 'ok', text: `${body.added?.length || 0} model(s) imported from the provider.` });
    } catch (error) { setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Could not import provider models.' }); }
    finally { setImportModelsBusy(false); }
  }

  async function addModel(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedProvider) return;
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch(`/api/providers/${selectedProvider.id}/models`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...modelForm, temperature: Number(modelForm.temperature), maxTokens: Number(modelForm.maxTokens), contextWindow: Number(modelForm.contextWindow) }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Could not add model.');
      setCatalog(body.catalog);
      setModelForm({ name: '', modelId: '', temperature: '0.7', maxTokens: '4000', contextWindow: '128000' });
      setShowModelForm(false);
      setNotice({ tone: 'ok', text: 'Model added to this provider.' });
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Could not add model.' });
    } finally {
      setBusy(false);
    }
  }

  const enabledModelCount = catalog.providers.reduce((total, provider) => total + provider.models.filter((model) => model.enabled).length, 0);

  return (
    <div className="settings-page">
      <header className="settings-page-header"><div><span className="codex-kicker">01 / Connections</span><h2>Providers</h2><p>Keep connections in one place, then choose the exact model from your composer.</p></div><div className="settings-header-actions"><span className="settings-count"><strong>{catalog.providers.length}</strong> providers · <strong>{enabledModelCount}</strong> ready models</span><Button size="sm" onClick={() => setShowProviderForm((open) => !open)}>+ Add provider</Button></div></header>
      {notice && <div className="settings-notice"><Alert tone={notice.tone === 'error' ? 'error' : 'success'} title={notice.tone === 'error' ? 'Action needed' : 'Saved'}>{notice.text}</Alert></div>}
      {showProviderForm && <form className="settings-form-card" onSubmit={addProvider}><div className="settings-form-heading"><div><span className="codex-kicker">New connection</span><h3>Add provider</h3></div><button type="button" className="settings-close" onClick={() => setShowProviderForm(false)}>×</button></div><div className="settings-form-grid"><label>Name<input className="settings-input" value={providerForm.name} onChange={(event) => setProviderForm({ ...providerForm, name: event.target.value })} placeholder="OpenAI" required /></label><label>Slug<input className="settings-input" value={providerForm.slug} onChange={(event) => setProviderForm({ ...providerForm, slug: event.target.value })} placeholder="openai" required /></label><label className="settings-form-wide">Base URL<input className="settings-input" type="url" value={providerForm.baseUrl} onChange={(event) => setProviderForm({ ...providerForm, baseUrl: event.target.value })} required /></label><label className="settings-form-wide">API key<input className="settings-input" type="password" value={providerForm.apiKey} onChange={(event) => setProviderForm({ ...providerForm, apiKey: event.target.value })} placeholder="Stored securely on this runtime" /></label></div><div className="settings-form-actions"><Button type="button" variant="secondary" onClick={() => setShowProviderForm(false)}>Cancel</Button><Button type="submit" loading={busy}>Create provider</Button></div></form>}
      <div className="provider-studio">
        <aside className="provider-list" aria-label="Providers">
          <div className="provider-list-head"><span>Configured providers</span><span>{catalog.providers.length}</span></div>
          {loading ? <div className="settings-empty">Loading catalog…</div> : catalog.providers.length === 0 ? <div className="settings-empty"><strong>No providers yet</strong><span>Add a connection to start selecting models in Chat.</span></div> : catalog.providers.map((provider) => <button type="button" key={provider.id} className={cx('provider-list-row', selectedProvider?.id === provider.id && 'is-active')} onClick={() => { setSelectedId(provider.id); setShowModelForm(false); }}><span className={cx('provider-list-dot', provider.enabled ? 'is-on' : 'is-off')} /><span className="provider-list-copy"><strong>{provider.name}</strong><small>{provider.models.length} model{provider.models.length === 1 ? '' : 's'} · {provider.enabled ? 'Enabled' : 'Paused'}</small></span><span className="provider-list-arrow">→</span></button>)}
        </aside>
        <section className="provider-detail">
          {!selectedProvider ? <div className="provider-detail-empty"><span className="settings-empty-mark">+</span><h3>Connect a model provider</h3><p>Your enabled models will appear in the Chat composer as grouped choices.</p><Button size="sm" onClick={() => setShowProviderForm(true)}>Add provider</Button></div> : <>
            <div className="provider-detail-head"><div><div className="provider-detail-title"><span className={cx('provider-list-dot', selectedProvider.enabled ? 'is-on' : 'is-off')} /><h3>{selectedProvider.name}</h3><span className={cx('settings-status-chip', selectedProvider.enabled ? 'is-on' : 'is-off')}>{selectedProvider.enabled ? 'Enabled' : 'Paused'}</span></div><p>{selectedProvider.base_url}</p></div><div className="settings-header-actions"><Button variant="secondary" size="sm" loading={busy} onClick={() => void mutate(() => requestProvider(selectedProvider.id, { enabled: !selectedProvider.enabled }), selectedProvider.enabled ? 'Provider paused.' : 'Provider enabled.')}>{selectedProvider.enabled ? 'Pause provider' : 'Enable provider'}</Button><Button variant="ghost" size="sm" loading={busy} onClick={() => { if (window.confirm(`Delete ${selectedProvider.name} and its models?`)) void mutate(() => requestDeleteProvider(selectedProvider.id), 'Provider deleted.').then(() => setSelectedId('')); }}>Delete</Button><Button variant="secondary" size="sm" loading={importModelsBusy} onClick={() => void discoverModels()}>Import models</Button><Button size="sm" onClick={() => setShowModelForm((open) => !open)}>+ Add model</Button></div></div>
            <div className="provider-detail-meta"><span><small>API key</small><strong>{selectedProvider.api_key_set ? 'Configured' : 'Not configured'}</strong></span><span><small>Models</small><strong>{selectedProvider.models.length}</strong></span><span><small>Composer</small><strong>{selectedProvider.enabled ? 'Available' : 'Hidden while paused'}</strong></span></div>
            {showImportModels && <form className="settings-form-card settings-model-form provider-import-form" onSubmit={importSelectedModels}><div className="settings-form-heading"><div><span className="codex-kicker">Provider discovery</span><h3>Import models from {selectedProvider.name}</h3><p className="settings-form-help">Endpoint: {selectedProvider.base_url}/v1/models</p></div><button type="button" className="settings-close" onClick={() => { setShowImportModels(false); setRemoteModels([]); setSelectedRemoteIds([]); }}>×</button></div>{importModelsBusy ? <div className="settings-empty">Loading models from provider…</div> : remoteModels.length === 0 ? <div className="settings-empty"><strong>No models returned</strong><span>Check the provider endpoint and credentials, then try again.</span></div> : <><div className="provider-import-toolbar"><span>{selectedRemoteIds.length} of {remoteModels.length} selected</span><div><button type="button" className="settings-text-button" onClick={() => setSelectedRemoteIds(remoteModels.map((model) => model.id))}>Select all</button><button type="button" className="settings-text-button" onClick={() => setSelectedRemoteIds([])}>Clear</button></div></div><div className="provider-import-options">{remoteModels.map((model) => <label key={model.id} className="provider-import-option"><input type="checkbox" checked={selectedRemoteIds.includes(model.id)} onChange={() => setSelectedRemoteIds((current) => current.includes(model.id) ? current.filter((id) => id !== model.id) : [...current, model.id])} /><span><strong>{model.name}</strong><small>{model.id}</small></span></label>)}</div><div className="settings-form-actions"><Button type="button" variant="secondary" onClick={() => setShowImportModels(false)}>Cancel</Button><Button type="submit" loading={importModelsBusy} disabled={selectedRemoteIds.length === 0}>Import selected</Button></div></>}</form>}
            {showModelForm && <form className="settings-form-card settings-model-form" onSubmit={addModel}><div className="settings-form-heading"><div><span className="codex-kicker">Model catalog</span><h3>Add model to {selectedProvider.name}</h3></div><button type="button" className="settings-close" onClick={() => setShowModelForm(false)}>×</button></div><div className="settings-form-grid"><label>Display name<input className="settings-input" value={modelForm.name} onChange={(event) => setModelForm({ ...modelForm, name: event.target.value })} placeholder="GPT-4.1" required /></label><label>Model ID<input className="settings-input" value={modelForm.modelId} onChange={(event) => setModelForm({ ...modelForm, modelId: event.target.value })} placeholder="gpt-4.1" required /></label><label>Temperature<input className="settings-input" type="number" min="0" max="2" step="0.1" value={modelForm.temperature} onChange={(event) => setModelForm({ ...modelForm, temperature: event.target.value })} /></label><label>Max output tokens<input className="settings-input" type="number" min="256" value={modelForm.maxTokens} onChange={(event) => setModelForm({ ...modelForm, maxTokens: event.target.value })} /></label><label>Context window<input className="settings-input" type="number" min="1024" value={modelForm.contextWindow} onChange={(event) => setModelForm({ ...modelForm, contextWindow: event.target.value })} /></label></div><div className="settings-form-actions"><Button type="button" variant="secondary" onClick={() => setShowModelForm(false)}>Cancel</Button><Button type="submit" loading={busy}>Add model</Button></div></form>}
            <div className="provider-model-list"><div className="provider-model-list-head"><span>Models in this provider</span><span>{selectedProvider.models.length}</span></div>{selectedProvider.models.length === 0 ? <div className="settings-empty"><strong>No models configured</strong><span>Add a concrete model ID before using this provider in Chat.</span></div> : selectedProvider.models.map((model: ProviderModel) => <div className="provider-model-row" key={model.id}><span className={cx('provider-list-dot', model.enabled && selectedProvider.enabled ? 'is-on' : 'is-off')} /><span className="provider-model-copy"><strong>{model.name}</strong><small>{model.model_id} · {model.context_window.toLocaleString()} context</small></span><span className={cx('settings-status-chip', model.enabled ? 'is-on' : 'is-off')}>{model.enabled ? 'Ready' : 'Paused'}</span><Button variant="ghost" size="sm" loading={busy} onClick={() => void mutate(() => requestModel(selectedProvider.id, model.id, { enabled: !model.enabled }), model.enabled ? 'Model paused.' : 'Model enabled.')}>{model.enabled ? 'Pause' : 'Enable'}</Button><Button variant="ghost" size="sm" loading={busy} onClick={() => { if (window.confirm(`Delete ${model.name}?`)) void mutate(() => requestDeleteModel(selectedProvider.id, model.id), 'Model deleted.'); }}>Delete</Button></div>)}</div>
          </>}
        </section>
      </div>
    </div>
  );
}
