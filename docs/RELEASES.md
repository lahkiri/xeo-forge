# Release History

Each release's changes, newest first. Product overview lives in the
[README](../README.md); the full per-release notes are under
[`docs/release-notes/`](release-notes/).

## What changed in v1.13.1

v1.13.1 is a hotfix for a real defect reported from an installed Windows copy of v1.13.0: the terminal failed with `conpty.node` missing. Next's file tracer cannot follow node-pty's runtime native loads, and the release smoke test never spawned a PTY — so a green pipeline shipped a dead terminal. Both closed at the class level: prepare-desktop rebuilds and ships both native modules (and asserts the binary exists), and the release smoke now types into a real PTY and requires the echo back — on Windows and Linux — before any release can publish.
---

## What changed in v1.13.0

v1.13.0 — **A Loop Worthy of a Strong Model** — makes the agent loop stop punishing frontier models. Guard profiles tune stagnation and read-loop thresholds by model tier (Opus/Claude 4+/GPT-5+/o-series get room to work; every other model keeps the historical numbers unchanged). The stagnation fingerprint now reads tool *observations*, so a converging fix-test loop is progress, not stagnation. And the `task_complete` summary gate obeys the LANGUAGE AFFINITY instruction it enforces: engineering-memory sections are accepted in six languages, fixing a defect where a structured Arabic summary was rejected for obeying the product's own language rule. 32 files / 673 tests.
---

## What changed in v1.12.0

v1.12.0 — **The Agent Development Environment** — completes the capability backends with their missing user surfaces and closes three terminal defects that only adversarial review and a real browser could find.

| Capability | What it does |
|---|---|
| **MCP Studio** | Add, disable, and delete stdio MCP servers from Settings. The registry existed since v1.11.0 with zero call sites — users could not add a server at all. CRUD routes + UI, with registry tests against a real stdio echo server. |
| **Git rail + events** | `git_status` / `git_commit` events are now actually emitted (they were declared but dead), a Repository rail shows branch/dirty/last-commit in the governance column, and `GET /api/tasks/:id/git/diff` feeds the Diff tab. |
| **Working Diff tab** | The Diff tab was wired to state no code path ever set. It now seeds from persisted history, captures live `git_op diff` results, and makes Files-changed rows clickable for a scoped diff. |
| **Terminal fixes** | Fast typing is no longer corrupted (parallel POSTs reached the PTY out of order); a page reload reconnects to the live session instead of leaking a PTY; `.bash_history` no longer dirties the workspace git status. |
| **Virtualized Activity** | Real windowing replaces the 200-row cap: every event in a run's history is reachable, the DOM stays bounded, variable row heights are measured per row. |
| **Markdown hardening** | Tables, blockquotes, ordered/nested lists, `~~~` fences, and safe links — pinned by a 19-case XSS battery. |

The test suite grew from 594 to **657 tests across 32 files**, is hermetic against ambient `DATABASE_URL`, and the whole surface was verified with HTTP E2E (26/26 on dev and production) plus real-browser checks of the terminal lifecycle and virtualization.
---

## What changed in v1.11.0

v1.11.0 — **Runtime Made Visible** — closes the gap between what the engine does and what the interface shows. The audit that started this release found a real bug: both client SSE handlers carried hardcoded event-type arrays that omitted `context_layers`, `memory`, and `memory_decision`, so v1.10.0's signature trust events were persisted, streamed, and then silently discarded by the browser. Chat subscribed to only four event types, which meant runtime state could never report "Reading project context".

| Capability | What it does |
|---|---|
| **Event registry** | `lib/agent/events.ts` declares all 21 event types once, with payload readers and per-surface subscriptions. `eventTypesFor('chat' \| 'work')` replaces both hardcoded arrays. A test scans the source for every `emitTaskEvent` call and fails if a type is undeclared — the dropped-event class of bug cannot recur. |
| **Execution timeline** | A real Activity surface built from the persisted event stream. Every row comes from `describeEvent()`; events with no standalone meaning render nothing rather than padding the list. Context compilation expands inline to name exactly which memories were injected. Deep mode shows raw event envelopes. |
| **Semantic primitives** | `AuthorityRow`, `RuntimeBanner`, `XeoFlow`, `ContextBudget`, `CurrentTruth`, `ResultArtifact` — components that understand the domain instead of generic cards. Each renders only from supplied backend state and shows nothing when a value is absent. |
| **Xeo Flow** | A clickable Context → Plan → Approval → Execute → Result trail derived from observable state only, never a step counter. Each stage opens the surface that explains it. |
| **Run commands** | `Cmd+K` gains run-scoped commands: open activity, inspect context, review memory, browse workspace, open preview, copy run ID. |

`authorityForMode()` mirrors what `executeTool` enforces at dispatch, and a test asserts it never describes restricted host execution as a sandbox and never reports browser interaction as plainly allowed.
---

## What changed in v1.10.0

v1.10.0 — **Persistent Context** — is the release where the agent gets more useful over time without becoming a black box. Memory, instructions, and runtime state all became inspectable and revocable.

| Capability | What it does |
|---|---|
| **Memory review** | The agent proposes bounded memory candidates at completion. They persist as `proposed` and are never injected into a run until you keep them. Keep, edit, or reject each one. |
| **Injection markers** | When an approved memory reaches a run, a `context_layers` event records exactly which ones. Memory never acts invisibly. |
| **Context Inspector** | Shows every context layer as in-prompt, withheld, overridden, or deduped, with the reason and a token estimate. Reads the same resolution pass the agent loop uses, so it cannot report a layer the model did not receive. |
| **Truthful runtime states** | `thinking...` is gone. Chat and Work now report queued, connecting, reading project context, using a named tool, writing the answer, compacting, retrying, or waiting for the provider - with elapsed time and a stall warning after 10s. |
| **CI on every push** | A `ci.yml` workflow runs typecheck, lint, tests, whitespace, browser smoke, broker tests, and build on push and pull request, not only at tag time. |

Detection in the Context Inspector is deterministic - scope specificity, disabled flags, approval status, expiry, duplicate content, and budget clamping. Xeo does not use a model to guess whether two instructions disagree.
---

## What changed in v1.9.0

v1.9.0 — **Chat is chat, Work is work** — split the two surfaces. Chat has no tabs, workspace browser, or approval controls because it cannot plan or write. Work leads with a governance rail showing live authority, plan state, project boundary, credits, and every file changed. The approval gate takes the full pane, and a `Cmd+K` command palette plus pane shortcuts make the whole app keyboard-reachable.
---

## What changed in v1.8.0

v1.8.0 hardened the foundation: the Go runtime broker binds loopback only and requires a shared secret for process control, the behavioral guards were consolidated into one implementation, and two test files that verified private copies of the logic were rewritten to import the shipped modules.
---

## What changed in v1.5.0

v1.5.0 — **Surface-Aware Workbench** — makes the product boundary explicit. Xeo Forge remains a SaaS control plane on the web, while the installed desktop application is a Local-First workbench: it opens directly into local projects, uses an internal local owner only for persistence compatibility, and does not expose credits, billing, account sign-in, multi-user administration, or SaaS navigation.

| Surface | Product identity |
|---|---|
| **Web SaaS** | Login, accounts, credits, multi-user administration, hosted persistence, and the existing operator controls remain available. |
| **Desktop Local** | Direct local workspace entry, project context, selected Browser Profile, local history, Control Center, and OTA updates without SaaS account chrome. |

The separation is enforced at both UI and server boundaries. Desktop Local hides SaaS navigation and returns a not-found response from credits and admin routes; local task creation and the agent loop bypass credit enforcement while hosted Web behavior remains unchanged.
---

## What changed in v1.4.0

Xeo Forge started as an approval-first coding agent. v1.4.0 turns that foundation into a local-first control plane for agentic work without removing the safety contract that made the project different. The release also establishes the desktop update path and the first cross-platform desktop packages.

| Layer | What it provides |
|---|---|
| **Governed runs** | A visible Plan -> Approve -> Build flow. Planning is read-only; write and execution tools remain locked until approval. |
| **Prompt Studio** | Manage pinned system, user, and task instructions from the UI instead of editing source code. |
| **Persistent memory** | Store deliberate, scoped, auditable memories. Runs propose bounded candidates; nothing enters context until you keep it. |
| **Agent Profiles** | Reusable roles such as Builder, Researcher, Analyst, Operator, or custom profiles. |
| **Agent Skills** | Reusable workflows that can be selected at task creation and combined with a profile. |
| **Context compiler** | Deterministic assembly of system policy, instructions, profile, skill, task context, and approved memories. |
| **Live audit trail** | Sequence-ordered events are persisted and streamed over SSE, so reloads preserve the same history. |
| **Restricted execution and preview** | Per-task file boundaries (realpath-checked), restricted host execution with an env whitelist and command blocklist, preview health checks, and workspace inspection. Not OS-level isolation — see Security posture. |
| **Operator controls** | Web SaaS authentication, credits, user administration, global model configuration, and task inspection; Desktop Local keeps only controls that operate locally. |
| **Intent Gate** | Separates ordinary Chat from Work intent and offers a short direct-versus-plan decision when a Work request asks for immediate execution. |
| **Browser Profiles** | Connect a Chromium extension to the browser profile the user chooses, persist that selection locally, and keep read-only browser inspection fail-closed. |
| **Desktop continuity** | Windows OTA Bootstrap from v1.3.1 onward, unattended restart installation in v1.4.0, and Linux AppImage/deb packages. |
