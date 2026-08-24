'use client';

import { useEffect, useState } from 'react';
import { Button, Card } from '@/components/ui';

/* ------------------------------------------------------------------ */
/*  MCP Studio — the user-owned half of the MCP surface.               */
/*                                                                     */
/*  A stdio server config is `command` + `args` + `env`: arbitrary     */
/*  code execution on the user's own machine, by the user. That is     */
/*  inherent to MCP and acceptable — but only as an explicit,          */
/*  user-initiated action from this UI. The agent can CALL configured  */
/*  servers (build mode, through the executeTool chokepoint) but can   */
/*  never create, edit, enable, or delete one.                         */
/* ------------------------------------------------------------------ */

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
  const [name, setName] = useState('');
  const [command, setCommand] = useState('');
  const [args, setArgs] = useState('');
  const [env, setEnv] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    const res = await fetch('/api/mcp/servers', { cache: 'no-store' });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'Could not load MCP servers.');
    setServers(body.servers || []);
  }

  useEffect(() => {
    void load().catch((err) => setError(err instanceof Error ? err.message : 'Could not load MCP servers.'));
  }, []);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim() || !command.trim()) return;
    setBusy(true);
    setError('');
    try {
      const payload: Record<string, unknown> = { name, command };
      if (args.trim()) {
        // One argument per line: argv is an array, not a shell string — the
        // placeholder says so, and splitting on newlines keeps every character
        // (including spaces and quotes) inside one argument.
        payload.args = args.split('\n').map((a) => a.replace(/\r$/, '')).filter((a) => a.length > 0);
      }
      if (env.trim()) {
        const parsedEnv: Record<string, string> = {};
        for (const line of env.split('\n')) {
          const clean = line.replace(/\r$/, '');
          const eq = clean.indexOf('=');
          if (eq <= 0) continue; // blank or KEY-less lines are skipped
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
      setName('');
      setCommand('');
      setArgs('');
      setEnv('');
      await load();
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
    <Card className="mb-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-meta font-semibold uppercase tracking-[0.18em] text-cyan-300">MCP SERVERS</p>
          <h2 className="mt-1 font-semibold">External tools, your decision</h2>
          <p className="mt-1 max-w-2xl text-meta leading-5 text-content-muted">
            Connect Model Context Protocol servers over stdio. Their tools appear to Build runs as
            <span className="font-mono"> mcp__&lt;server&gt;__&lt;tool&gt;</span> names, run through the same
            approval gate as every other tool, and their output is treated as untrusted data. Servers run as
            processes on this machine with your permissions — add only sources you trust.
          </p>
        </div>
        <span className="rounded-full bg-cyan-500/10 px-2.5 py-1 text-micro text-cyan-300">
          {servers.filter((s) => s.enabled).length} enabled
        </span>
      </div>
      {error && <p className="mb-3 rounded-md border border-red-500/20 bg-signal-fail/10 px-3 py-2 text-meta text-signal-fail">{error}</p>}
      <form onSubmit={create} className="grid gap-3 md:grid-cols-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Server name, e.g. local-files"
          aria-label="MCP server name"
          className="rounded-md border border-line bg-ink-700/60 px-3 py-2 text-ui outline-none placeholder:text-content-muted focus:border-cyan-400/50"
        />
        <input
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          placeholder="Command, e.g. npx or /usr/local/bin/mcp-server"
          aria-label="MCP server command"
          className="rounded-md border border-line bg-ink-700/60 px-3 py-2 text-ui outline-none placeholder:text-content-muted focus:border-cyan-400/50"
        />
        <textarea
          value={args}
          onChange={(e) => setArgs(e.target.value)}
          rows={2}
          placeholder={'Arguments, one per line, e.g.\n-y\n@modelcontextprotocol/server-filesystem\n/tmp'}
          aria-label="MCP server arguments, one per line"
          className="w-full resize-y rounded-md border border-line bg-ink-700/60 px-3 py-2 font-mono text-ui leading-6 outline-none placeholder:text-content-muted focus:border-cyan-400/50"
        />
        <textarea
          value={env}
          onChange={(e) => setEnv(e.target.value)}
          rows={2}
          placeholder={'Environment variables, one NAME=VALUE per line (optional)'}
          aria-label="MCP server environment variables"
          className="w-full resize-y rounded-md border border-line bg-ink-700/60 px-3 py-2 font-mono text-ui leading-6 outline-none placeholder:text-content-muted focus:border-cyan-400/50"
        />
        <div className="md:col-span-2">
          <Button type="submit" disabled={busy || !name.trim() || !command.trim()}>Add server</Button>
        </div>
      </form>
      {servers.length > 0 && (
        <div className="mt-5 grid gap-3 md:grid-cols-2">
          {servers.map((server) => (
            <div key={server.id} className="rounded-control border border-line-subtle bg-ink-700/60 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-ui font-medium text-content-primary">{server.name}</p>
                  <p className="mt-1 break-all font-mono text-micro text-content-muted">
                    {server.command} {server.args.join(' ')}
                  </p>
                </div>
                <span className={`shrink-0 rounded-full px-2 py-1 text-micro ${server.enabled ? 'bg-green-500/15 text-green-300' : 'bg-white/10 text-content-muted'}`}>
                  {server.enabled ? 'enabled' : 'disabled'}
                </span>
              </div>
              {Object.keys(server.env).length > 0 && (
                <p className="mt-2 font-mono text-micro text-content-faint">
                  env: {Object.keys(server.env).join(', ')}
                </p>
              )}
              <p className="mt-2 text-micro text-content-muted">
                Tools surface as <span className="font-mono">mcp__{server.slug}__*</span> in Build mode.
              </p>
              <div className="mt-3 flex gap-2">
                <Button variant="ghost" disabled={busy} onClick={() => void toggle(server)}>
                  {server.enabled ? 'Disable' : 'Enable'}
                </Button>
                <Button variant="ghost" disabled={busy} onClick={() => void remove(server)}>Delete</Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
