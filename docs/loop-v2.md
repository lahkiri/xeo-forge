# Agent Loop v2 Architecture — The Governed Loop

> v1.20 direction document. Status: **foundation shipped** (progress model,
> declarative permissions, autonomy levels — all enforced in the live loop and
> contract-tested). Everything else below is sequenced work, not vaporware:
> each section names what exists today vs. what comes next.

## Thesis

The strength of Claude Code, OpenHands, Cursor, Codex and the rest does not
come from one clever `while` loop. It comes from decisions *around* the loop:
how context is gathered, when work runs in parallel, how state survives, how
completion is verified, and how a failing run is caught early.

Xeo Forge's difference is not "the same but weaker". It is one constraint none
of them centers: **high autonomy under explicit human authority**. Every
architectural choice below serves that constraint. Where we borrow a pattern,
we borrow the principle and attach evidence to it — that attachment is ours.

Evidence tiers used throughout:

1. **[documented]** — vendor's official docs
2. **[observable]** — readable in their open source
3. **[inference]** — our engineering judgment
4. **[bench]** — needs measurement before we trust it

---

## What shipped in v1.20 (foundation)

### 1. Progress model replaces stagnation counters

`lib/agent/progress.ts` — authoritative in the loop since this release.

The old guard asked *"did the agent repeat itself N times?"*. That punishes a
legitimate test-fix loop (same two tools, changing results) and forgives a
useless one (alternating two reads forever). The new question is *"did the
world change?"*:

```ts
type ProgressSignal = {
  newFilesRead; newFilesChanged;
  testOutcomeChanged;      // exit-code shape flipped: fail→pass or pass→fail
  errorClassChanged;       // a DIFFERENT failure after a fix is information
  newEvidence; taskStateChanged;
}
```

- Repetition with movement is **work**. Zero-movement loops are nudged after
  an idle window, failed after grace — even if every fingerprint differs.
- `errorClass()` collapses churn (numbers, quoted strings, paths) so "expected
  3 got 4" ≡ "expected 71 got 92" while TypeError ≠ AssertionError.
- Information gain (`InformationGainTracker`) replaces fixed read ceilings:
  25 genuinely-new files stay un-nudged; re-reading known content triggers a
  nudge. [inference] borrowed from exploration-budget thinking; thresholds are
  [bench].
- Contract tests: `test/progress-model.test.ts` (15 cases), including the two
  scenarios the old counter got wrong by construction.

### 2. Authority as data — declarative permissions

`lib/agent/permissions.ts`. Permission was scattered across `if`s (workspace
confinement in files.ts, denylist in code.ts). Scattered checks cannot be
audited and cannot be shown to a user. Now:

```
PermissionRule { action, resource, effect: allow|ask|deny }
evaluatePermission(rules, action, resource) → { effect, matched, ruleIndex }
```

- Last-match-wins ordering, whole-value globs, trailing `" *"` shell
  convenience — same semantics OpenCode documents [documented], plus what is
  ours: every decision cites **which rule** decided it, so evidence bundles
  answer "why was this allowed?" with a citation.
- Batch evaluation (multi-file patches): strictest of deny > ask > allow.
- No match ⇒ **ask**. Authority is never granted by silence.

### 3. Autonomy levels — state, not a boolean

The point Malek made, now architecture: `read_only · assist · execute · autonomous`.

- `read_only`: plan mode as a real boundary — edits/shell denied, not
  discouraged (cf. Gemini CLI's policy-enforced plan mode [documented]).
- `execute` (default): routine edits, commands, commits proceed; anything
  leaving the machine asks — `git push`, `npm publish`, `docker push`.
- Secrets ask at **every** level. Outside-the-workspace asks at every level.
- Universal denies (rm -rf /, mkfs, dd to device, fork bombs, metadata IP,
  force-push) are appended AFTER any user overrides, so no configuration can
  grant them. Tested with a grant-everything override.
- Enforcement is real, not UI-only: `RunAgentArgs.autonomyLevel` →
  `effectiveRules()` → `ToolContext` → `CodeTool`, which consults the rule set
  before every command and names the denying rule in the error. The regex
  floor stays for legacy callers.
- 22 contract tests: `test/permissions-contract.test.ts`.

---

## Sequenced next (v1.21+), in order of leverage

### 4. Hooks — deterministic control [documented: Claude Code]

Anything that must ALWAYS happen should not depend on the model remembering.
Planned event surface, each hook writing into the existing seq-ordered event
stream (so hooks inherit the audit trail rather than inventing one):

```
PreTool · PostTool · ToolFailure · PreCompact · TaskCompleted
SubagentStart · SubagentStop
```

Ship order: PreTool (permission interplay + audit), PostTool (evidence),
TaskCompleted (verification summary) first — those three cover 80% of real
automation need.

### 5. Explicit AgentState [observable: OpenHands]

Today loop state lives in local variables (consecutiveReads, chatTextBuffer…).
Extract to one serializable object — objective, plan ref, progress history
(the ProgressModel already keeps `signals`), pending verification, authority
level + overrides, failures. Payoff: resume-after-crash, replay, and the UI
reading truth instead of inferring it from events.

### 6. Checkpoints [documented: Replit/Kilo]

Before major mutations and after verified milestones:

```
checkpoint_id · task_id · parent_checkpoint · git_ref · diff_ref · test_result · created_at
```

Desktop-local v1 is honest git refs + event rows (no block-device magic).
Rollback of a subagent's failed work becomes possible once delegation lands.

### 7. Governed delegation (the thesis feature)

Children as first-class governed tasks:

```
parent_task_id · budget_credits · tool_scope · fs_scope
max_depth · time_limit · model_id · autonomy_level
```

Rendered as a governance tree on the task page. A child failing verification
can roll back to its checkpoint (#6). This is where Xeo Forge stops being
"another agent" and becomes the review surface for agent work.

### 8. Best-of-N with independent judges [documented: Cursor]

Only after single-loop quality is proven (#4–#7). N candidates, each its own
worktree + governance tree, scored by independent verification (tests +
judge model), presented WITH scores and evidence. The human approves; the
system never claims its own child won.

### 9. Dynamic verification contracts [inference]

TaskClassifier at intake picks required verification per task type (bugfix →
failing-test-repro; migration → schema check + rollback; UI → typecheck +
smoke). Replaces always-`npm test`. Cheap to add once #5 exists.

### 10. Parallel execution DAG

Reads/searches parallel; same-file writes, git mutations, migrations
serialized. Start with read-batch parallelism inside one iteration — lowest
risk, immediate latency win. Full DAG waits for #5 (state must know the plan).

---

## What we deliberately do NOT do

- Copy numbers ("Claude allows N reads"). Principles only; thresholds are
  profiled and benchmarked.
- Call workspace confinement a sandbox. `docs/security-model.md` stays honest:
  string-level checks, known bypasses documented. A real sandbox later is a
  capability *enhancer*, not just security [inference].
- Add subagents/best-of-N before the single-agent loop earns them.
- Make guards fight the model. Guards fight **bad state**; the progress model
  is the proof of that principle.

## The metric that matters

Not iterations. **Quality-adjusted autonomy**:

```
useful autonomous progress ÷ human interventions
```

tracked alongside false-completion rate and regression rate. The benchmark
suite (20–30 seeded tasks: bugfix/feature/refactor/security/UI/multi-step)
lands before v2.0; models are compared on correct-result-with-least-intervention,
not on pretty diffs.
