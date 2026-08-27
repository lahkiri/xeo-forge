'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui';
import { IconChevronRight, IconPlus, IconCheck } from '@/components/icons';

interface McpServerConfigView {
  id: string;
  name: string;
  slug: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  enabled: boolean;
}

export default function McpStudio() {
  const [servers, setServers] = useState<McpServerConfigView[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [name, setName] = useState('');
  const [command, setCommand] = useState('');
  const [args, setArgs] = useState('');
  const [env, setEnv] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showAdd, setShowAdd] = useState(false);

  const selected = servers.find((server) => server.id === selectedId) ?? null;

  async function load() {
    const res = await fetch('/api/mcp/servers', { cache: 'no-store' });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'Could not load MCP servers.');
    const nextServers = body.servers || [];
    setServers(nextServers);
    setSelectedId((current) => current && nextServers.some((server: McpServerConfigView) => server.id === current) ? current : nextServers[0]?.id || '');
  }

  useEffect(() => {
    void load().catch((err) => setError(err instanceof Error ? err.message : 'Could not load MCP servers.'));
  }, []);

  function resetForm() {
    setName('');
    setCommand('');
    setArgs('');
    setEnv('');
  }

  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim() || !command.trim()) return;
    setBusy(true);
    setError('');
    try {
      const payload: Record<string, unknown> = { name: name.trim(), command: command.trim() };
      if (args.trim()) payload.args = args.split('\n').map((arg) => arg.replace(/\r$/, '')).filter((arg) => arg.length > 0);
      if (env.trim()) {
        const parsedEnv: Record<string, string> = {};
        for (const line of env.split('\n')) {
          const clean = line.replace(/\r$/, '');
          const eq = clean.indexOf('=');
          if (eq <= 0) continue;
          parsedEnv[clean.slice(0, eq).trim()] = clean.slice(eq + 1);
        }
        if (Object.keys(parsedEnv).length > 0) payload.env = parsedEnv;
      }
      const res = await fetch('/api/mcp/servers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Could not add MCP server.');
      resetForm();
      setShowAdd(false);
      await load();
      if (body.server?.id) setSelectedId(body.server.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add MCP server.');
    } finally {
      setBusy(false);
    }
  }

  async function toggle(server: McpServerConfigView) {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/mcp/servers/${server.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: !server.enabled }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Could not update MCP server.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update MCP server.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(server: McpServerConfigView) {
    if (!window.confirm(`Delete the ${server.name} server? Tools from this server will disappear from Build runs.`)) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/mcp/servers/${server.id}`, { method: 'DELETE' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Could not delete MCP server.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete MCP server.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mcp-studio">
      <div className="mcp-studio-header">
        <div>
          <p className="text-meta font-semibold uppercase tracking-[0.18em] text-signal-run">Capabilities / MCP</p>
          <h2 className="mt-1 text-xl font-semibold tracking-tight text-content-primary">External tools, your decision</h2>
          <p className="mt-2 max-w-2xl text-meta leading-5 text-content-muted">
            Connect trusted stdio servers. Their tools run behind the same approval gate as every other Build tool, and their output is treated as untrusted data.
          </p>
        </div>
        <div className="mcp-studio-count"><strong>{servers.filter((server) => server.enabled).length}</strong><span>enabled</span></div>
      </div>

      {error && <p className="mb-3 rounded-md border border-red-500/20 bg-signal-fail/10 px-3 py-2 text-meta text-signal-fail">{error}</p>}

      <div className="mcp-master-detail">
        <aside className="mcp-server-list" aria-label="Configured MCP servers">
          <div className="mcp-list-heading"><span>Configured servers</span><span>{servers.length}</span></div>
          <div className="mcp-list-scroll">
            {servers.length === 0 && <p className="px-3 py-8 text-center text-meta leading-5 text-content-muted">No servers configured yet.</p>}
            {servers.map((server) => (
              <button key={server.id} type="button" onClick={() => { setSelectedId(server.id); setShowAdd(false); }} className={`mcp-server-row ${selectedId === server.id && !showAdd ? 'is-active' : ''}`}>
                <span className={`mcp-server-dot ${server.enabled ? 'is-on' : ''}`} aria-hidden="true" />
                <span className="min-w-0 flex-1 text-left"><strong>{server.name}</strong><small>{server.command}</small></span>
                <span className="mcp-server-arrow" aria-hidden="true"><IconChevronRight size={12} /></span>
              </button>
            ))}
          </div>
          <button type="button" className={`mcp-add-row ${showAdd ? 'is-active' : ''}`} onClick={() => { setShowAdd(true); setSelectedId(''); }}><span aria-hidden="true" className="inline-flex"><IconPlus size={12} /></span> Add server</button>
        </aside>

        <section className="mcp-detail-pane">
          {showAdd ? (
            <form onSubmit={create}>
              <div className="mcp-detail-heading"><div><p className="text-micro font-semibold uppercase tracking-[0.16em] text-content-faint">New capability</p><h3 className="mt-1 text-lg font-semibold text-content-primary">Add MCP server</h3></div><span className="mcp-detail-index">01 / setup</span></div>
              <p className="mt-2 max-w-xl text-meta leading-5 text-content-muted">Define the process and environment explicitly. Xeo Forge will not install or enable a server without your action.</p>
              <div className="mcp-form-grid mt-6">
                <label><span>Server name</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="local-files" aria-label="MCP server name" /></label>
                <label><span>Command</span><input value={command} onChange={(event) => setCommand(event.target.value)} placeholder="npx or /usr/local/bin/mcp-server" aria-label="MCP server command" /></label>
                <label><span>Arguments <em>one per line</em></span><textarea value={args} onChange={(event) => setArgs(event.target.value)} rows={4} placeholder={'-y\n@modelcontextprotocol/server-filesystem\n/tmp'} aria-label="MCP server arguments" /></label>
                <label><span>Environment <em>optional, NAME=VALUE</em></span><textarea value={env} onChange={(event) => setEnv(event.target.value)} rows={4} placeholder="API_KEY=…" aria-label="MCP server environment" /></label>
              </div>
              <div className="mcp-detail-actions"><Button type="button" variant="ghost" onClick={() => { setShowAdd(false); resetForm(); }}>Cancel</Button><Button type="submit" disabled={busy || !name.trim() || !command.trim()} loading={busy}>Add server</Button></div>
            </form>
          ) : selected ? (
            <div>
              <div className="mcp-detail-heading"><div><p className="text-micro font-semibold uppercase tracking-[0.16em] text-content-faint">Selected server</p><h3 className="mt-1 text-lg font-semibold text-content-primary">{selected.name}</h3></div><span className={`mcp-detail-status ${selected.enabled ? 'is-on' : ''}`}>{selected.enabled ? 'Enabled' : 'Disabled'}</span></div>
              <p className="mt-2 text-meta text-content-muted">Tools surface as <span className="font-mono">mcp__{selected.slug}__*</span> in Work mode.</p>
              <div className="mcp-detail-block mt-6"><p className="mcp-block-label">Process</p><code>{selected.command} {selected.args.join(' ')}</code></div>
              <div className="mcp-detail-block mt-3"><p className="mcp-block-label">Environment keys</p><p className="text-meta text-content-secondary">{Object.keys(selected.env).length ? Object.keys(selected.env).join(' · ') : 'No environment variables exposed'}</p></div>
              <div className="mcp-approval-note mt-5"><span className="mcp-approval-mark inline-flex"><IconCheck size={12} /></span><span><strong>Approval protected</strong><small>Every MCP call remains behind the Work approval gate.</small></span></div>
              <div className="mcp-detail-actions"><Button variant="secondary" disabled={busy} onClick={() => void toggle(selected)}>{selected.enabled ? 'Disable server' : 'Enable server'}</Button><Button variant="ghost" disabled={busy} onClick={() => void remove(selected)}>Delete</Button></div>
            </div>
          ) : (
            <div className="mcp-empty-detail"><span className="mcp-empty-mark">MCP</span><h3>Choose a capability</h3><p>Select a configured server or add a new one. The detail view keeps status, process, and approval behavior in one place.</p><Button onClick={() => setShowAdd(true)}>Add server</Button></div>
          )}
        </section>
      </div>
    </section>
  );
}
