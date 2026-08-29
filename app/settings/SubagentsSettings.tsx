'use client';

/**
 * Subagents settings (v1.25, Phase 5) — delegation stops being buried in the
 * task-start form. This page states the four design guarantees verbatim and
 * the honest boundary: read-only by construction; write-capable parallel
 * delegation waits for a documented concurrent-write design.
 */

export default function SubagentsSettings() {
  return (
    <div className="settings-page">
      <header className="settings-page-header">
        <div>
          <span className="codex-kicker">08 / Delegation</span>
          <h2>Subagents</h2>
          <p>How parallel delegation works, what it inherits, and what it can never do.</p>
        </div>
        <span className="settings-status-chip is-off">read-only by construction</span>
      </header>
      <div className="settings-stack">
        <section className="settings-panel">
          <div className="settings-panel-head"><div><span className="codex-kicker">delegate_research</span><h3>Parallel read-only research</h3><p>2–4 subagents fan out in parallel. Each executes under the PARENT task&apos;s exact autonomy level through the same authorizeToolCall gate — a subagent can never hold broader authority than its parent.</p></div></div>
          <div className="settings-policy-list">
            <label className="settings-check is-static">✔ Inherited authority — the parent&apos;s level shapes every subagent rule</label>
            <label className="settings-check is-static">✔ Read-only toolset — files/lists/web only; concurrent writes are impossible by construction</label>
            <label className="settings-check is-static">✔ sub-N attribution — every step lands in the audit trail tagged with which subagent did it</label>
            <label className="settings-check is-static">✔ Bounded — max 3 iterations and one tool call per iteration per subagent; failures are isolated and reported per-subagent</label>
          </div>
        </section>
        <section className="settings-panel">
          <div className="settings-panel-head"><div><span className="codex-kicker">Known gap</span><h3>Write-capable delegation: not available, by design</h3><p>Concurrent writes to the same files race. The README documents the boundary: write-capable parallel delegation waits for a proven concurrent-write design (conflict resolution + per-writer attribution) documented before any code lands. This page will carry that design&apos;s controls when it exists.</p></div></div>
        </section>
        <div className="settings-info-card">
          <span className="settings-empty-mark">i</span>
          <div>
            <h3>Where delegation is triggered</h3>
            <p>Inside a run, the agent calls <code>delegate_research</code> when its plan calls for parallel investigation. Per-level subagent rules decide availability: denied at read-only, asked at assist, allowed from execute up — same as any other governed tool.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
