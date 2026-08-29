'use client';

/**
 * Sandbox settings (v1.25, Phase 5) — the three isolation tiers get a real
 * Settings section instead of living only inside the "New work session"
 * form. Descriptions render VERBATIM from the same SANDBOX_MODES data the
 * executor reads, and the Docker chip shows the actual probe result —
 * never an assumption (honesty rules, AGENTS.md §16).
 */

import { useEffect, useState } from 'react';
import { Alert } from '@/components/ui';

interface SandboxSpec {
  id: string;
  label: string;
  describe: string;
  isolation: string;
}

export default function SandboxSettings() {
  const [modes, setModes] = useState<SandboxSpec[]>([]);
  const [docker, setDocker] = useState<{ available: boolean; version: string | null; detail: string; guidance: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/sandbox', { cache: 'no-store' })
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || 'Could not load sandbox tiers.');
        return body;
      })
      .then((body) => {
        if (!alive) return;
        setModes(body.modes ?? []);
        setDocker(body.docker ?? null);
      })
      .catch((err) => alive && setError(err instanceof Error ? err.message : 'Could not load sandbox tiers.'));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="settings-page">
      <header className="settings-page-header">
        <div>
          <span className="codex-kicker">07 / Isolation</span>
          <h2>Sandbox</h2>
          <p>The three execution tiers, described exactly as the executor enforces them. The tier is chosen per work session — this page is the honest reference.</p>
        </div>
        {docker && (
          <span className={docker.available ? 'settings-status-chip is-on' : 'settings-status-chip is-off'}>
            {docker.available ? `Docker connected${docker.version ? ` · ${docker.version}` : ''}` : 'Docker not detected'}
          </span>
        )}
      </header>
      {error && <div className="settings-notice"><Alert tone="error" title="Action needed">{error}</Alert></div>}
      <div className="settings-stack">
        {modes.map((mode) => (
          <section key={mode.id} className="settings-panel">
            <div className="settings-panel-head">
              <div>
                <span className="codex-kicker">{mode.id}</span>
                <h3>{mode.label}</h3>
                <p>{mode.describe}</p>
              </div>
              <span className="settings-status-chip is-off">{mode.isolation}</span>
            </div>
            {mode.id === 'docker' && docker && !docker.available && docker.guidance && (
              <p className="browser-setup-note">{docker.detail} — {docker.guidance}</p>
            )}
          </section>
        ))}
        <div className="settings-info-card">
          <span className="settings-empty-mark">i</span>
          <div>
            <h3>Where the tier is chosen</h3>
            <p>Per session, in the Work setup (field 06). A docker-tier command that fails mid-flight fails closed with an actionable message — nothing downloads silently and no half state is left behind.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
