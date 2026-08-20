# Xeo Forge V3 — Agent & Architecture Rules

> Product contract: **The Control Plane for Agentic Work**. Chat is conversation; Work is governed agency.

This file is the contract for working in this repo. Keep it short, keep it enforced.
If a change violates a rule here, the change is wrong — not the rule.

## 1. What this product is

One governed AI agent with reusable execution context:
1. **Chat surface** — conversational answers and exploration; it never creates a plan or executes write tools.
2. **Work surface** — intent-aware agent work. Normal messages stay conversational; explicit planning starts Planning, and direct execution requests pause for an auditable user choice.
3. **Planning mode** — read-only inspection, produces a structured plan for approval.
4. **Build mode** — executes an immutable approved plan or an immutable, explicitly accepted execution brief.
5. **Context layers** — Prompt Studio instructions, approved memories, Agent Profiles, and Agent Skills are compiled into the run context.

The agent:
1. receives a conversation or Work request from a user and classifies intent before selecting planning or execution,
2. loads policy, profile, skill, task context, and approved memories,
3. inspects and analyzes (planning) or executes (build),
4. returns a final result and bounded memory candidates,
5. persists full history and audit events,
6. consumes credits per run.

Plus auth, per-user credits, admin controls, ONE global model configuration,
reusable profiles and skills, context management, and an inspectable audit trail.

New capabilities must preserve the approval gate, task-scoped authorization, single source of truth, and end-to-end UI-to-persistence behavior.

## 2. Hard architecture rules (non-negotiable)

1. **Single source of truth.** One canonical schema per entity. One writer per
   resource. No dual persistence. No second copy of the same logical data that
   can drift.
2. **One delivery path for events.** Task events are persisted with a monotonic
   per-task `seq`. SSE replays from the DB only, tracks `maxSeq`, then forwards
   live events with `seq > maxSeq`. No in-memory replay buffer racing the DB.
   (This is the V1 duplication bug. Do not reintroduce it.)
3. **No silent failures.** No `catch {}` without logging. Every caught error is
   logged with context. Persistence failures must be visible, never swallowed.
4. **End-to-end or not at all.** No UI control that points at a route that does
   not exist. No route that only half-works. Build the full path:
   input → agent → tools → persistence → UI.
5. **One global model.** All users share one model config. No per-user model
   selection. Source of truth: `model_settings` row id=1, seeded from env.
   API keys are NEVER returned to any client — always masked.
6. **Credits are atomic.** Debit via conditional `UPDATE ... WHERE balance >= ?`.
   Every balance change writes a `credit_ledger` row with `balance_after`.
   No read-then-write race.
7. **Authz on every task-scoped route.** Owner-or-admin check, always.
8. **No ungoverned feature creep.** Do not add subagents, teams, connectors,
   schedules, marketplaces, plugins, analytics, or permission frameworks without
   a written V3 design, explicit authorization boundaries, and an end-to-end path.
9. **No dead code.** Don't scaffold for "future features". Delete what isn't used.
10. **Typecheck stays clean.** `tsc --noEmit` has zero errors. Never hide errors
    behind `ignoreBuildErrors`.

## 3. Tech stack

- Next.js 14 App Router, React 18, TypeScript 5 (strict).
- Tailwind CSS for styling.
- DB: SQLite (better-sqlite3) in dev, PostgreSQL (pg) in prod, via one adapter
  exposing `prepare().{get,all,run}` returning Promises.
- LLM: `openai` SDK against an OpenAI-compatible endpoint (streaming tool calls).
- Auth: cookie session (`xeo_session`), token = random 32 bytes, stored as sha256.
- Local runtime: an optional Go process broker (`native/runtime-broker`), bound to
  loopback and gated by a per-install shared secret.

## 4. Data model (the only tables)

- `users` — id, email, password_hash, display_name, is_admin, is_root_admin,
  is_suspended, created_at.
- `auth_sessions` — token_hash (pk), user_id, expires_at.
- `credits` — user_id (pk), balance, daily_grant, last_reset_at, updated_at.
- `credit_ledger` — id, user_id, delta, reason, ref_id, balance_after, created_at.
- `tasks` — id, user_id, goal, status (including awaiting_decision), mode
  (chat|planning|build), project_path, intent_kind, decision_state,
  decision_expires_at, plan (latest proposed plan), approved_plan (immutable
  snapshot frozen at approval — also holds the frozen execution brief for an
  accepted direct-execution decision), plan_version, profile_id, skill_id,
  result_summary, credits_spent, error, created_at, updated_at.
- `task_events` — id, task_id, seq, type, content (JSON), created_at.
  UNIQUE(task_id, seq).
- `messages` — id, task_id, role (user|assistant|system), content, active,
  created_at. Conversation history per task. `active` distinguishes live-context
  rows (1) from archived rows (0) that compaction has summarized away.
- `model_settings` — id (always 1), name, base_url, api_key, model_id,
  temperature, max_tokens, context_window, auto_compact_threshold, updated_at.
  `context_window` = total tokens the model can hold. `auto_compact_threshold` =
  context usage % that triggers automatic compaction (1–100, default 80).
- `admin_actions` — id, admin_id, target_user_id, action, detail, created_at.
- `uploads` — id, task_id, user_id, filename, kind, status, byte_size, rel_path,
  file_count, extracted_bytes, error, created_at, updated_at. Quarantined until
  scanned; archives are expanded into the task workspace.
- `agent_profiles` — id, user_id, name, kind, description, instructions, enabled,
  version, created_at, updated_at. Reusable agent roles.
- `agent_skills` — id, user_id, name, kind, description, instructions,
  profile_id, enabled, version, created_at, updated_at. Reusable workflows,
  optionally bound to one profile.
- `agent_instructions` — id, user_id, task_id, scope, name, content, priority,
  enabled, version, created_at, updated_at. Prompt Studio layers.
- `agent_memories` — id, user_id, task_id, scope, kind, content, status,
  confidence, source_task_id, source_message_id, pinned, expires_at, created_at,
  updated_at. Candidates are `proposed` until the user approves them; only
  approved memories are compiled into run context.

Do not add tables without a real, present use. V3 tables must have an end-to-end API, agent, persistence, and UI path.

**Design note: intent metadata.** Intent classification is deterministic and
re-derivable from the goal (`lib/agent/intent.ts`), so only the resulting
`intent_kind` is persisted. Confidence and reason are emitted as `intent` events
in the audit trail rather than duplicated as task columns (rule 1).

**Design note: execution briefs.** A direct-execution decision freezes its brief
into `approved_plan`, reusing the one immutable-contract column the build loop
already reads. A second column would be a parallel path to the same behavior.

**Design note: execution_cursor.** There is no persisted step list or cursor.
The agent loop is model-driven — the LLM decides what to do each iteration.
Adding a cursor would be dead state that never drives execution.

## 5. Execution flow (must work end-to-end)

1. User submits a Chat or Work request with a surface and goal.
2. Server classifies intent deterministically before starting any governed run.
3. Conversation intent starts Chat; explicit planning starts Planning; direct execution creates `awaiting_decision` and starts nothing.
4. Server checks credits where the selected run requires them, debits creation cost atomically (402 if insufficient).
5. Server creates `tasks` row with the canonical intent and decision state.
6. A decision endpoint accepts `direct` or `plan` once, only before its server-enforced deadline. Direct acceptance freezes an execution brief; plan acceptance starts Planning.
7. Runner starts fire-and-forget; `.catch` marks task failed AND emits a failure
   event (never silent).
8. Agent builds context, streams model output, and dispatches tools.
   - **Chat mode:** conversational/read-only tools only; it cannot write or execute.
   - **Planning mode:** file and browser inspection only; write tools are
     HARD-LOCKED at dispatch. Planning concludes with task_complete and status=planned.
   - **Build mode:** full tool access. Executes approved_plan or accepted
     execution_brief as an immutable contract — no plan rewriting.
   - **Browser:** local extension inspection is read-only by default. Navigation,
     clicks, typing, and submission require an explicit interaction policy.
9. Every step is emitted as a `task_events` row (seq-ordered) and over SSE.
10. Per-tool-call credits are debited as incurred; total is recorded on the task.
11. Planning task ends: status=planned, proposed plan stored. Build task ends:
    status=completed|failed, result_summary stored.
12. User watches live via SSE and sees history on reload (same data, one source).
13. User approves/rejects the plan: approve atomically snapshots the plan into
    approved_plan, flips mode to build, and starts the build run. Reject resets to
    planning mode and auto-starts a new planning run for revision. A direct Work
    decision freezes execution_brief and enters build only after explicit choice.
14. User can send follow-up messages on completed/failed tasks — conversation
    history is persisted in messages and injected into the agent's LLM context.
15. User can switch modes at any time (non-running tasks) via `POST /tasks/:id/mode`.
    Switching to planning clears approved_plan and auto-starts a new planning run.
16. Admin can inspect any user, any task, any ledger entry; adjust credits;
    enable/disable users; view/update the global model.



## 5.5 Behavioral guards (runtime safety)

The agent loop includes runtime guards against common failure modes observed in
production. These are NOT prompt-level suggestions — they are code-enforced
checks. The detectors, thresholds and nudge copy live in `lib/agent/guards.ts`
(one implementation, imported by both dispatch paths in `lib/agent/loop.ts` and
by the unit tests); the double-fail check lives in `lib/agent/runner.ts`.

**Text-termination guard**: In build mode, the loop does NOT accept text-only
completions via `finishReason='stop'`. Instead it checks for:
1. Question-to-user patterns → autonomy violation nudge, loop continues
2. Description-not-doing patterns → action required nudge, loop continues
3. No real work done → nudge to use tools, loop continues
4. Work done but no task_complete → nudge to call the tool, loop continues
5. Incomplete todos → forces completion before accepting

Planning mode text termination is unchanged — plans legitimately end in text.

**Fallback path guard**: The `<action>` fallback path (for models without
native tool calling) applies the same guards when no `<action>` block is found
in the model output.

**Read-only loop detection**: A `consecutiveReads` counter increments on
`file_read`/`file_list` and resets on `file_write`/`file_edit`/`code_execute`.
At threshold 6, a system nudge tells the agent to stop reading and start
building. Only active in build mode.

**Double-fail prevention**: The runner catch block in `runner.ts` checks
whether the task is already in a terminal state (`completed`, `failed`,
`planned`) before emitting error/done events. This prevents the observed
double-fail pattern where `failRun()` inside the loop emits events and then
the runner catch fires again.

**appendMessage race fix**: `appendMessage()`, `compactMessages()`, and
`createUpload()` now use `INSERT ... RETURNING *` for PostgreSQL to avoid
the race condition where a re-SELECT could return a different row inserted
by a concurrent operation. SQLite keeps the existing re-SELECT (single-writer).

## 6. Layout

```
app/                  # pages + API routes (App Router)
  api/                # auth, tasks, tasks/[id], tasks/[id]/stream,
                      # tasks/[id]/approve, tasks/[id]/reject,
                      # tasks/[id]/decision, tasks/[id]/messages,
                      # tasks/[id]/mode, tasks/[id]/preview,
                      # tasks/[id]/uploads, tasks/[id]/workspace,
                      # tasks/[id]/export, agent/*, browser/*, runtime,
                      # credits, settings/model, admin/*
lib/
  db/                 # index (adapter), schema, bootstrap, queries — the ONLY DB writers
  auth/               # password, session, guard
  credits/            # engine (atomic debit/grant/adjust), pricing
  model/              # config (global, env + DB row id=1), errors
  agent/              # runner, loop, guards, tools, files, code, prompts,
                      # intent, context, compaction, timeline, preview, uploads
  sse/                # emitter (seq-based, single delivery path)
  types.ts
components/           # minimal shared UI
native/runtime-broker # optional Go process broker (loopback + shared secret)
desktop/electron      # Electron shell: broker + Next supervision, browser bridge
test/                 # vitest unit tests (import real lib/ modules, never copies)
```

## 7. Agent tools (the only ones)

`file_read`, `file_write`, `file_edit`, `file_list`, `code_execute`
(bash/python in a sandboxed per-task workspace with env whitelist + path
boundaries + dangerous-command blocklist), `http_request`, `browser`, `task_complete`.
`browser` uses the optional loopback extension and is read-only by default;
interaction requires an explicit user-granted policy. `task_complete` is called
exactly once, as a tool, never as text.

Workspace root per task: `$TASK_WORK_DIR/<taskId>` (default `/tmp/xeo-tasks`).
All file/code access is confined to that directory (realpath-checked).

## 8. Commands

- `npm run dev` — local dev.
- `npm run typecheck` — `tsc --noEmit`, must be clean.
- `npm run lint` — ESLint, must be clean (no warnings).
- `npm test` — vitest unit tests.
- `npm run build` — production build.
- `npm run db:init` — create schema + seed root admin from env.
- `go test ./...` in `native/runtime-broker` — broker auth and bind tests.

## 9. Definition of done

A user creates a task → agent executes it → credits are consumed correctly →
result is stored in history → admin can inspect and modify user state → all
users use the same global model → no duplicate writers, no silent failures →
typecheck + lint + tests + build all pass.

Tests must exercise the shipped implementation. A test that re-declares the
logic it is checking is not a test — it is a second copy that will silently
diverge (rule 1).

## 10. Intent-aware execution (core feature)

The agent supports Chat and Work surfaces that share the same execution engine but
never share unsafe defaults:

**Chat mode** (`mode=chat`):
- Conversational responses with read-only file, HTTP, and optional browser inspection.
- Never creates a plan for ordinary conversation and never writes or executes code.

**Work intake** (`surface=work`):
- Normal conversation remains Chat-like.
- Explicit planning starts `mode=planning` immediately.
- A direct execution request creates `status=awaiting_decision` and starts nothing.
- The UI offers a short, server-enforced 30-second choice: direct execution or
  planning first. Expiry closes the choice; it never defaults to execution.
- Ambiguous intent can request clarification or offer bounded choices before a run.

**Planning mode** (`mode=planning`):
- Tool access: file_read, file_list, http_request, browser, task_complete ONLY.
- Write tools are HARD-LOCKED at `executeTool` dispatch and throw if attempted.
- Produces a structured plan (objective, findings, steps, verification, risks).
- User must approve or reject before any writes occur.

**Build mode** (`mode=build`):
- Full tool access, but browser interaction remains separately policy-gated.
- Executes ONLY the `approved_plan` or the accepted `execution_brief`.
- Plan cannot be rewritten during execution — no dynamic re-planning.
- Ends with status=`completed` or `failed`.

**Approval gate:**
- Atomic conditional UPDATE: `approved_plan=plan, mode='build', status='pending'`
  guarded by `WHERE status='planned'` — prevents double-approval races.
- Reject sets status='failed' with the rejection reason.

**Session persistence:**
- Conversation history is persisted in the `messages` table (role + content per task).
- The agent loop loads full conversation history at start and injects it into the
  LLM context, so follow-up messages have full context from prior runs.
- Follow-up messages are allowed on completed/failed tasks — they reset the task
  to pending and start a new agent run with conversation history.

**Mode switching:**
- Users can switch modes at any time via `POST /tasks/:id/mode`.
- Switching to planning clears approved_plan, resets to pending, and auto-starts
  a new planning run. Switching to build is available for non-running tasks.
- Mode switching preserves conversation history, execution state, and session context.

**Why no execution_cursor:** The agent loop is model-driven — the LLM decides
what to do each iteration. There is no persisted step list, so a cursor would
be dead state that never drives execution (violates rule 9).

## 11. Context management (core feature)

The agent manages its context window natively — no patch layer, no wrapper,
no parallel subsystem.

**Context usage percentage** (`context_usage_percentage`):
- Derived from the canonical in-memory messages array the agent sends to the
  model. Uses ~4-chars-per-token estimation with per-message overhead.
- Emitted as a `context` event every iteration: `{ used_tokens, context_window,
  percentage, threshold }`. This is the single authoritative metric.
- No separate tracking engine. No fake/hardcoded indicator.

**Admin-configurable threshold** (`auto_compact_threshold`):
- Stored in `model_settings` row id=1 alongside model config (single source of
  truth — no new config subsystem).
- Clamped to [10, 95] to prevent bad values from disabling or thrashing.
- Default: 80%. Admin can change via the `/admin` UI.

**Automatic compaction**:
- When `context_usage_percentage >= auto_compact_threshold`, the agent loop
  triggers compaction automatically.
- Compaction: older messages are archived (`active=0`) and replaced with ONE
  system summary message (`active=1`) that preserves critical facts, user
  intent, execution state, and plan/mode awareness.
- The system prompt, approved plan, and mode state are NEVER touched.
- Summary is generated via the same LLM (using `COMPACTION_PROMPT`).
- Compaction events are emitted for observability: `{ archived, summary_tokens,
  before_percentage, after_percentage }`.

**Message ordering**:
- `getMessages()` returns ALL messages (active + archived) in chronological
  order — for UI display and audit.
- `getContextMessages()` returns only `active=1` messages — for the agent's
  LLM context each run.
- Compaction summary sorts naturally as the oldest context row (system role).

## 12. Adaptive execution boundary (no hardcoded limits)

The agent loop uses adaptive stagnation detection instead of fixed iteration caps.
There is NO numeric safety cap — termination is purely semantic.

**Termination signals (in priority order):**
1. `task_complete` tool call → normal completion.
2. `finishReason === 'stop'` with text → accepted as final answer.
3. Credit exhaustion → `failRun` with out-of-credits message.
4. Stagnation detection → escalated nudge, then termination if persistent.
5. Unhandled error → `failRun` with error message.

Credit economics is the primary execution budget. A productive agent with
sufficient credits runs until it finishes — no iteration counting.

**Stagnation detection:**
- Each iteration computes a tool-call fingerprint (tool names + first 100 chars of args).
- If the fingerprint matches the previous N iterations (default 3): stagnation detected.
- First escalation: a `STAGNATION_NUDGE` system message is injected into context.
- If stagnation continues for N more iterations after escalation: hard termination.
- When progress is made (different fingerprint): stagnation counter decreases.

**Why no numeric safety cap:**
- A numeric cap (even a high one) can terminate a productive agent that is making
  measurable forward progress every iteration.
- Credit exhaustion is the natural economic boundary — the admin controls the budget.
- Stagnation detection handles broken loops (same tool calls repeated).
- If the model never calls task_complete but keeps producing useful work, credits
  will eventually exhaust. The admin can always intervene manually.
- The old hardcoded limit of 25 iterations prematurely terminated complex tasks.
- The intermediate safety cap of 200 was also architecturally wrong — a productive
  agent at iteration 201 should not be killed.

**Escalation model:**
- Stagnation detected → inject nudge → model adjusts approach → continue.
- If model doesn't adjust → stagnation persists → terminate with descriptive error.
- The nudge explicitly tells the model to: change approach, call task_complete, or explain blockers.
