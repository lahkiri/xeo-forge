'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button, Card } from '@/components/ui';
import type { AuthUser, AdminAction, ModelSettingsSafe } from '@/lib/types';

/** User row as delivered by the admin API (password_hash stripped, stats joined). */
type AdminUserRow = {
  id: string;
  email: string;
  display_name: string;
  is_admin: number;
  is_root_admin: number;
  is_suspended: number;
  created_at: string;
  balance: number;
  task_count: number;
};

interface Props {
  currentUser: AuthUser;
  initialUsers: AdminUserRow[];
  initialModel: ModelSettingsSafe | null;
  initialActions: AdminAction[];
}

export default function AdminClient({ currentUser, initialUsers, initialModel, initialActions }: Props) {
  const router = useRouter();
  const [users, setUsers] = useState<AdminUserRow[]>(initialUsers);
  const actions = initialActions;
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function refreshUsers() {
    const res = await fetch('/api/admin/users');
    if (res.ok) {
      const data = await res.json();
      setUsers(data.users);
    }
  }

  function refreshActions() {
    // Admin actions are rendered from server props; reload to pull the latest log.
    router.refresh();
  }

  function flash(msg: string) {
    setNotice(msg);
    setError('');
    setTimeout(() => setNotice(''), 4000);
  }

  function fail(msg: string) {
    setError(msg);
    setNotice('');
  }

  /* ----- Create user ----- */
  const [cuEmail, setCuEmail] = useState('');
  const [cuName, setCuName] = useState('');
  const [cuPassword, setCuPassword] = useState('');
  const [cuAdmin, setCuAdmin] = useState(false);
  const [creating, setCreating] = useState(false);

  async function createUser(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError('');
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: cuEmail,
          password: cuPassword,
          displayName: cuName,
          isAdmin: cuAdmin,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        fail(data.error ?? 'Failed to create user');
        return;
      }
      setCuEmail('');
      setCuName('');
      setCuPassword('');
      setCuAdmin(false);
      flash(`Created user ${data.user.email}`);
      await refreshUsers();
      await refreshActions();
    } catch (err) {
      fail(err instanceof Error ? err.message : 'Failed to create user');
    } finally {
      setCreating(false);
    }
  }

  /* ----- Suspend / enable ----- */
  async function toggleSuspend(u: AdminUserRow) {
    const suspended = !u.is_suspended;
    try {
      const res = await fetch(`/api/admin/users/${u.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ suspended }),
      });
      const data = await res.json();
      if (!res.ok) {
        fail(data.error ?? 'Failed to update user');
        return;
      }
      flash(`${suspended ? 'Suspended' : 'Enabled'} ${u.email}`);
      await refreshUsers();
      await refreshActions();
    } catch (err) {
      fail(err instanceof Error ? err.message : 'Failed to update user');
    }
  }

  /* ----- Adjust credits ----- */
  async function adjustCredits(u: AdminUserRow) {
    const raw = window.prompt(`Adjust credits for ${u.email} (current ${u.balance}).\nEnter a non-zero integer delta (e.g. 50 or -10):`);
    if (raw === null) return;
    const delta = Number(raw);
    if (!Number.isInteger(delta) || delta === 0) {
      fail('Delta must be a non-zero integer');
      return;
    }
    const reason = window.prompt('Reason for this adjustment:') ?? '';
    if (reason.trim().length === 0) {
      fail('Reason is required');
      return;
    }
    try {
      const res = await fetch(`/api/admin/users/${u.id}/credits`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ delta, reason }),
      });
      const data = await res.json();
      if (!res.ok) {
        fail(data.error ?? 'Failed to adjust credits');
        return;
      }
      flash(`${u.email} balance is now ${data.balance}`);
      await refreshUsers();
      await refreshActions();
    } catch (err) {
      fail(err instanceof Error ? err.message : 'Failed to adjust credits');
    }
  }

  /* ----- Model settings ----- */
  const [model, setModel] = useState<ModelSettingsSafe | null>(initialModel);
  const [mName, setMName] = useState(initialModel?.name ?? '');
  const [mBaseUrl, setMBaseUrl] = useState(initialModel?.base_url ?? '');
  const [mModelId, setMModelId] = useState(initialModel?.model_id ?? '');
  const [mTemp, setMTemp] = useState(String(initialModel?.temperature ?? 0.7));
  const [mMaxTokens, setMMaxTokens] = useState(String(initialModel?.max_tokens ?? 4000));
  const [mContextWindow, setMContextWindow] = useState(String(initialModel?.context_window ?? 128000));
  const [mThreshold, setMThreshold] = useState(String(initialModel?.auto_compact_threshold ?? 80));
  const [mApiKey, setMApiKey] = useState('');
  const [savingModel, setSavingModel] = useState(false);

  async function saveModel(e: React.FormEvent) {
    e.preventDefault();
    setSavingModel(true);
    setError('');
    try {
      const body: Record<string, unknown> = {
        name: mName,
        baseUrl: mBaseUrl,
        modelId: mModelId,
        temperature: Number(mTemp),
        maxTokens: Number(mMaxTokens),
        contextWindow: Number(mContextWindow),
        autoCompactThreshold: Number(mThreshold),
      };
      if (mApiKey.trim().length > 0) body.apiKey = mApiKey;
      const res = await fetch('/api/admin/model', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        fail(data.error ?? 'Failed to save model settings');
        return;
      }
      setModel(data.model);
      setMApiKey('');
      flash('Model settings saved');
    } catch (err) {
      fail(err instanceof Error ? err.message : 'Failed to save model settings');
    } finally {
      setSavingModel(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Admin</h1>
        <Link href="/dashboard" className="text-sm text-indigo-300 hover:underline">
          ← Back to dashboard
        </Link>
      </header>

      {error && (
        <div className="mb-4 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </div>
      )}
      {notice && (
        <div className="mb-4 rounded-md border border-green-500/30 bg-green-500/10 px-3 py-2 text-sm text-green-300">
          {notice}
        </div>
      )}

      {/* Users */}
      <section className="mb-8">
        <h2 className="mb-3 text-lg font-medium">Users ({users.length})</h2>
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-white/10 text-xs uppercase text-gray-400">
              <tr>
                <th className="px-3 py-2">Email</th>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Role</th>
                <th className="px-3 py-2">Balance</th>
                <th className="px-3 py-2">Tasks</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const isSelf = u.id === currentUser.id;
                const isRoot = !!u.is_root_admin;
                const canSuspend = !isSelf && !isRoot;
                return (
                  <tr key={u.id} className="border-b border-white/5">
                    <td className="px-3 py-2">{u.email}</td>
                    <td className="px-3 py-2">{u.display_name}</td>
                    <td className="px-3 py-2">
                      {isRoot ? 'root' : u.is_admin ? 'admin' : 'user'}
                    </td>
                    <td className="px-3 py-2">{u.balance}</td>
                    <td className="px-3 py-2">{u.task_count}</td>
                    <td className="px-3 py-2">
                      {u.is_suspended ? (
                        <span className="text-red-300">suspended</span>
                      ) : (
                        <span className="text-green-300">active</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex gap-2">
                        <Button variant="ghost" onClick={() => adjustCredits(u)}>
                          Credits
                        </Button>
                        {canSuspend && (
                          <Button
                            variant={u.is_suspended ? 'primary' : 'danger'}
                            onClick={() => toggleSuspend(u)}
                          >
                            {u.is_suspended ? 'Enable' : 'Suspend'}
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      </section>

      {/* Create user */}
      <section className="mb-8">
        <h2 className="mb-3 text-lg font-medium">Create user</h2>
        <Card>
          <form onSubmit={createUser} className="grid gap-3 sm:grid-cols-2">
            <input
              className="rounded-md border border-white/15 bg-transparent px-3 py-2 text-sm"
              type="email"
              placeholder="email"
              value={cuEmail}
              onChange={(e) => setCuEmail(e.target.value)}
              required
            />
            <input
              className="rounded-md border border-white/15 bg-transparent px-3 py-2 text-sm"
              type="text"
              placeholder="display name"
              value={cuName}
              onChange={(e) => setCuName(e.target.value)}
              required
            />
            <input
              className="rounded-md border border-white/15 bg-transparent px-3 py-2 text-sm"
              type="password"
              placeholder="password (min 8 chars)"
              value={cuPassword}
              onChange={(e) => setCuPassword(e.target.value)}
              minLength={8}
              required
            />
            <label className="flex items-center gap-2 text-sm text-gray-300">
              <input
                type="checkbox"
                checked={cuAdmin}
                onChange={(e) => setCuAdmin(e.target.checked)}
              />
              Grant admin
            </label>
            <div className="sm:col-span-2">
              <Button type="submit" disabled={creating}>
                {creating ? 'Creating…' : 'Create user'}
              </Button>
            </div>
          </form>
        </Card>
      </section>

      {/* Model settings */}
      <section className="mb-8">
        <h2 className="mb-3 text-lg font-medium">Global model</h2>
        <Card>
          <p className="mb-3 text-xs text-gray-400">
            One model configuration for the entire platform. API key:{' '}
            {model?.api_key_set ? (
              <span className="text-green-300">set</span>
            ) : (
              <span className="text-red-300">not set</span>
            )}
            {' '}— the stored key is never displayed. Leave the API key field blank to keep the current key.
          </p>
          <form onSubmit={saveModel} className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              <span className="mb-1 block text-gray-400">Name</span>
              <input
                className="w-full rounded-md border border-white/15 bg-transparent px-3 py-2 text-sm"
                value={mName}
                onChange={(e) => setMName(e.target.value)}
                required
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-gray-400">Model ID</span>
              <input
                className="w-full rounded-md border border-white/15 bg-transparent px-3 py-2 text-sm"
                value={mModelId}
                onChange={(e) => setMModelId(e.target.value)}
                required
              />
            </label>
            <label className="text-sm sm:col-span-2">
              <span className="mb-1 block text-gray-400">Base URL</span>
              <input
                className="w-full rounded-md border border-white/15 bg-transparent px-3 py-2 text-sm"
                type="url"
                value={mBaseUrl}
                onChange={(e) => setMBaseUrl(e.target.value)}
                required
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-gray-400">Temperature (0–2)</span>
              <input
                className="w-full rounded-md border border-white/15 bg-transparent px-3 py-2 text-sm"
                type="number"
                step="0.1"
                min="0"
                max="2"
                value={mTemp}
                onChange={(e) => setMTemp(e.target.value)}
                required
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-gray-400">Max tokens</span>
              <input
                className="w-full rounded-md border border-white/15 bg-transparent px-3 py-2 text-sm"
                type="number"
                min="1"
                value={mMaxTokens}
                onChange={(e) => setMMaxTokens(e.target.value)}
                required
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-gray-400">Context window (tokens)</span>
              <input
                className="w-full rounded-md border border-white/15 bg-transparent px-3 py-2 text-sm"
                type="number"
                min="1024"
                value={mContextWindow}
                onChange={(e) => setMContextWindow(e.target.value)}
                required
              />
              <span className="mt-1 block text-xs text-gray-500">
                Total tokens the model can hold. Used to calculate context usage %.
              </span>
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-gray-400">Auto-compact threshold (%)</span>
              <input
                className="w-full rounded-md border border-white/15 bg-transparent px-3 py-2 text-sm"
                type="number"
                min="10"
                max="95"
                value={mThreshold}
                onChange={(e) => setMThreshold(e.target.value)}
                required
              />
              <span className="mt-1 block text-xs text-gray-500">
                Context usage % that triggers automatic compaction (10–95, default 80).
              </span>
            </label>
            <label className="text-sm sm:col-span-2">
              <span className="mb-1 block text-gray-400">API key (blank = keep current)</span>
              <input
                className="w-full rounded-md border border-white/15 bg-transparent px-3 py-2 text-sm"
                type="password"
                placeholder="••••••••"
                value={mApiKey}
                onChange={(e) => setMApiKey(e.target.value)}
              />
            </label>
            <div className="sm:col-span-2">
              <Button type="submit" disabled={savingModel}>
                {savingModel ? 'Saving…' : 'Save model settings'}
              </Button>
            </div>
          </form>
        </Card>
      </section>

      {/* Admin actions log */}
      <section>
        <h2 className="mb-3 text-lg font-medium">Recent admin actions</h2>
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-white/10 text-xs uppercase text-gray-400">
              <tr>
                <th className="px-3 py-2">When</th>
                <th className="px-3 py-2">Action</th>
                <th className="px-3 py-2">Detail</th>
              </tr>
            </thead>
            <tbody>
              {actions.length === 0 && (
                <tr>
                  <td className="px-3 py-2 text-gray-500" colSpan={3}>
                    No actions recorded yet.
                  </td>
                </tr>
              )}
              {actions.map((a) => (
                <tr key={a.id} className="border-b border-white/5">
                  <td className="px-3 py-2 whitespace-nowrap text-gray-400">
                    {new Date(a.created_at).toLocaleString()}
                  </td>
                  <td className="px-3 py-2">{a.action}</td>
                  <td className="px-3 py-2 text-gray-300">{a.detail ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </section>
    </div>
  );
}
