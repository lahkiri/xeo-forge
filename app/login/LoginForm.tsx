'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button, Card, Eyebrow } from '@/components/ui';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Login failed');
        return;
      }
      router.push('/chat');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-12 sm:px-6">
      <div className="pointer-events-none absolute -left-32 top-1/4 h-96 w-96 rounded-full bg-cyan-300/[0.07] blur-3xl" />
      <div className="pointer-events-none absolute -right-32 bottom-1/4 h-96 w-96 rounded-full bg-violet-400/[0.07] blur-3xl" />
      <div className="relative grid w-full max-w-5xl gap-8 lg:grid-cols-[1.1fr_420px] lg:items-center">
        <section className="hidden px-4 lg:block">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-cyan-300/25 bg-cyan-300/[0.08] text-xl text-cyan-200 shadow-[0_0_32px_rgba(103,232,249,0.12)]">◇</div>
            <div>
              <p className="text-sm font-semibold tracking-tight text-white">Xeo Forge</p>
              <p className="text-[10px] uppercase tracking-[0.22em] text-gray-500">Agentic control plane</p>
            </div>
          </div>
          <div className="mt-12"><Eyebrow>Governed agentic work</Eyebrow></div>
          <h1 className="mt-4 max-w-xl text-5xl font-semibold tracking-[-0.04em] text-white xl:text-6xl">Turn agent capability into accountable execution.</h1>
          <p className="mt-6 max-w-lg text-base leading-7 text-gray-400">Plan with intent. Govern behavior with reusable control layers. Build with an auditable run identity that stays yours.</p>
          <div className="mt-10 grid max-w-lg grid-cols-3 gap-3">
            {[
              ['01', 'Plan', 'Make intent explicit'],
              ['02', 'Govern', 'Set the boundary'],
              ['03', 'Build', 'Prove the outcome'],
            ].map(([number, title, detail]) => (
              <div key={number} className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-3">
                <p className="text-[10px] font-semibold tracking-[0.18em] text-cyan-200/70">{number}</p>
                <p className="mt-3 text-sm font-medium text-gray-200">{title}</p>
                <p className="mt-1 text-[11px] leading-4 text-gray-600">{detail}</p>
              </div>
            ))}
          </div>
        </section>

        <Card className="border-cyan-300/10 bg-white/[0.045] p-6 shadow-2xl shadow-black/30 sm:p-8">
          <div className="mb-7 lg:hidden">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-cyan-300/25 bg-cyan-300/[0.08] text-lg text-cyan-200">◇</div>
              <div>
                <p className="text-sm font-semibold text-white">Xeo Forge</p>
                <p className="text-[10px] uppercase tracking-[0.2em] text-gray-500">Agentic control plane</p>
              </div>
            </div>
          </div>
          <Eyebrow>Welcome back</Eyebrow>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-white">Enter the Workbench.</h2>
          <p className="mt-2 text-sm leading-6 text-gray-500">Your profiles, skills, memory, and run ledger are waiting.</p>
          <form onSubmit={onSubmit} className="mt-7 space-y-4">
            <label className="block space-y-2">
              <span className="block text-xs font-medium text-gray-400">Email</span>
              <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="w-full rounded-xl border border-white/[0.1] bg-[#070b12]/80 px-3.5 py-3 text-sm text-gray-100 outline-none transition placeholder:text-gray-600 focus:border-cyan-300/50 focus:ring-4 focus:ring-cyan-300/[0.08]" />
            </label>
            <label className="block space-y-2">
              <span className="block text-xs font-medium text-gray-400">Password</span>
              <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className="w-full rounded-xl border border-white/[0.1] bg-[#070b12]/80 px-3.5 py-3 text-sm text-gray-100 outline-none transition placeholder:text-gray-600 focus:border-cyan-300/50 focus:ring-4 focus:ring-cyan-300/[0.08]" />
            </label>
            {error && <p role="alert" className="rounded-xl border border-red-300/15 bg-red-400/[0.08] px-3 py-2 text-sm text-red-200">{error}</p>}
            <Button type="submit" size="lg" disabled={loading} className="w-full justify-center">{loading ? 'Opening Workbench…' : 'Enter Workbench'}<span aria-hidden="true">→</span></Button>
          </form>
          <p className="mt-6 text-center text-sm text-gray-500">Need an account? <Link href="/register" className="font-medium text-cyan-300 hover:text-cyan-200">Create one</Link></p>
        </Card>
      </div>
    </main>
  );
}
