'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button, Card, StatusBadge } from '@/components/ui';
import { UploadButton, uploadToTask } from '@/components/UploadButton';
import type { AgentProfile, AuthUser, Task } from '@/lib/types';

export default function DashboardClient({
  user,
  initialTasks,
  initialBalance,
}: {
  user: AuthUser;
  initialTasks: Task[];
  initialBalance: number;
}) {
  const router = useRouter();
  const [tasks, setTasks] = useState<Task[]>(initialTasks);
  const [balance, setBalance] = useState(initialBalance);
  const [goal, setGoal] = useState('');
  const [profiles, setProfiles] = useState<AgentProfile[]>([]);
  const [profileId, setProfileId] = useState('');
  const [staged, setStaged] = useState<File[]>([]);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch('/api/agent/profiles').then(async (res) => {
      if (res.ok) setProfiles((await res.json()).profiles || []);
    }).catch(() => {});
  }, []);

  async function refresh() {
    const [tRes, cRes] = await Promise.all([fetch('/api/tasks'), fetch('/api/credits')]);
    if (tRes.ok) setTasks((await tRes.json()).tasks);
    if (cRes.ok) setBalance((await cRes.json()).balance);
  }

  async function submitTask(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!goal.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ goal, profileId: profileId || null }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 402) {
          setError(`Insufficient credits (balance ${data.balance}, need ${data.needed}).`);
        } else {
          setError(data.error || 'Failed to create task');
        }
        return;
      }
      setGoal('');
      setProfileId('');
      // Attach any staged files to the newly created task via the same
      // shared handler + same route (no separate pipeline). Best-effort.
      if (staged.length > 0) {
        for (const f of staged) {
          const r = await uploadToTask(data.task.id, f);
          if (!r.ok) console.error(`[dashboard] upload failed for ${f.name}: ${r.error}`);
        }
        setStaged([]);
      }
      router.push(`/tasks/${data.task.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setSubmitting(false);
    }
  }

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-6">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Xeo Forge</h1>
          <p className="text-sm text-gray-400">{user.displayName}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <Link href="/settings">
            <Button variant="ghost">Prompt Studio</Button>
          </Link>
          <span className="rounded-md bg-white/5 px-3 py-1.5 text-sm">
            <span className="text-gray-400">Credits:</span>{' '}
            <span className="font-semibold">{balance}</span>
          </span>
          {user.isAdmin && (
            <Link href="/admin">
              <Button variant="ghost">Admin</Button>
            </Link>
          )}
          <Button variant="ghost" onClick={logout}>
            Sign out
          </Button>
        </div>
      </header>

      <Card className="mb-6">
        <form onSubmit={submitTask} className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="block text-sm font-medium">New task</label>
            <span className="rounded-full border border-indigo-400/30 bg-indigo-400/10 px-3 py-1 text-xs text-indigo-200">
              Plan → Approve → Build
            </span>
          </div>
          <textarea
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            rows={3}
            placeholder="Describe what you want the agent to do..."
            className="w-full resize-y rounded-md border border-white/15 bg-black/30 px-3 py-2 text-sm outline-none focus:border-indigo-500"
          />
          {profiles.length > 0 && (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <label htmlFor="agent-profile" className="text-xs text-gray-500">Agent profile</label>
              <select id="agent-profile" value={profileId} onChange={(e) => setProfileId(e.target.value)} className="rounded-md border border-white/10 bg-black/30 px-3 py-2 text-xs text-gray-300 outline-none focus:border-indigo-500">
                <option value="">Xeo default</option>
                {profiles.filter((p) => p.enabled).map((p) => <option key={p.id} value={p.id}>{p.name} · {p.kind}</option>)}
              </select>
              <Link href="/settings" className="text-[11px] text-indigo-300 hover:text-indigo-200">manage profiles</Link>
            </div>
          )}
          {error && <p className="text-sm text-red-400">{error}</p>}
          {staged.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {staged.map((f, i) => (
                <span
                  key={`${f.name}-${i}`}
                  className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.03] px-2 py-1 text-[11px] text-gray-300"
                >
                  <span className="truncate max-w-[12rem]">{f.name}</span>
                  <button
                    type="button"
                    onClick={() => setStaged((prev) => prev.filter((_, j) => j !== i))}
                    className="text-gray-500 hover:text-gray-200"
                    aria-label={`Remove ${f.name}`}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <UploadButton
              taskId={null}
              onStaged={(f) => setStaged((prev) => [...prev, f])}
              label="attach file"
            />
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Starting...' : 'Run task'}
            </Button>
          </div>
        </form>
      </Card>

      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-300">Your tasks</h2>
        <button onClick={refresh} className="text-xs text-gray-400 hover:text-gray-200">
          Refresh
        </button>
      </div>

      <div className="space-y-2">
        {tasks.length === 0 && (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-white/10 py-12 text-center">
            <svg className="mb-3 h-10 w-10 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l4 2m6-2a10 10 0 11-20 0 10 10 0 0120 0z" />
            </svg>
            <p className="text-sm font-medium text-gray-400">No tasks yet</p>
            <p className="mt-1 text-xs text-gray-500">Create your first task to get started.</p>
          </div>
        )}
        {tasks.map((t) => (
          <Link key={t.id} href={`/tasks/${t.id}`}>
            <Card className="transition hover:border-white/25">
              <div className="flex items-start justify-between gap-3">
                <p className="line-clamp-2 flex-1 text-sm">{t.goal}</p>
                <div className="flex items-center gap-2">
                  <StatusBadge status={t.status} />
                </div>
              </div>
              <div className="mt-2 flex gap-3 text-xs text-gray-500">
                <span>{new Date(t.created_at).toLocaleString()}</span>
                <span>{t.credits_spent} credits</span>
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
