# Release History

Each release's changes, newest first. Product overview lives in the
[README](../README.md); the full per-release notes are under
[`docs/release-notes/`](release-notes/).

## What changed in v1.22.0

v1.22.0 — **One Language** — two honesty problems wearing UI clothes. The chat surface could hang forever in "Thinking" with a locked composer because the client treated the SSE stream as the only status truth: any missed `done` event (dead EventSource, provider crash, Electron reload orphaning the stream) left the status "running" permanently, and `cancelled` was not even in the client's terminal check. Both surfaces now treat the stream as an input and the task row as the truth — a 4-second reconciliation poll adopts the server's terminal state, refreshes to surface the persisted answer when nothing streamed, keeps a Stop escape hatch rendered for the whole live turn, and states connection loss honestly instead of silently pretending to think. In parallel, every leftover unicode glyph (`←` `→` `⌘K` `⚙` `◇` `◈` `◎` `⊕` `◌` `⌕` `‹` `›` `×` `▶` `✓` `✕` `◆` `▲` `▼` `☀` `☾` `⌗` `•••`) became a stroke icon from one 29-icon inline library, so workspace, settings, and the live run finally speak one visual language. Verified by a 12/12 pure-module smoke under Node type-stripping, esbuild syntax validation of all 22 touched files, and 13 CI regression assertions pinning the reconciliation contract.

## What changed in v1.21.0

v1.21.0 — **The Chosen Boundary** — closes the gap disclosed on discovery in v1.20: autonomy levels are now chosen at Work setup (field 04 + the intake card), stored on the task row with loud validation, forwarded by every run path including follow-up messages and plan approvals (a later message can no longer smuggle broader authority), and enforced at a new central dispatch gate where every world-touching call is classified into the rule set's `(action, resource)` — with `ask` failing closed and citing the deciding rule instead of silently proceeding, secrets genuinely blocked at every level at dispatch, and the universal denies surviving even a grant-everything override. The wiring itself was a find: the loop had been building its tool context before computing the rules, so even an explicit level could never have reached the tools. The Work Authority panel now renders the policy that actually runs. CI green on PR and master, +40 dispatch-time contract tests, and the honest boundary is written down: interactive per-action approvals remain follow-up work — unresolved asks refuse rather than pause.

## What changed in v1.20.1

v1.20.1 — **The Honest Hotfix** — born from a radical audit that ran real workloads against the product instead of trusting its own tests. The streamed chat answer now survives failure and cancellation (it used to vanish forever — 6,280 chars of a live reply were the proof). Chat no longer offers work tools, so a simple greeting can no longer be killed as 'failed' for making todo mutations. The cancellation registry became a process-wide singleton after a live test showed cancel reporting 'no live loop' while events flowed another 97 seconds. Provider errors now speak human ('The model provider rejected the API key...') with next steps, not raw internals. And the audit's live capability probes ship as reusable scripts: MCP handshake+tool-call against a real server (output quarantined as untrusted data), browser bridge policy checks, skill file reads with path-escape guards.

## What changed in v1.20.0

v1.20.0 — **The Governed Loop** — the loop's biggest intellectual upgrade. Progress replaced counters: stagnation detection now asks "did the world change?" instead of "did you repeat yourself?", so a legitimate test-fix loop is never punished and a useless alternating-read loop is always caught. Authority became data: declarative `{action, resource, effect}` rules where every decision cites its rule, with four autonomy levels (read-only / assist / execute / autonomous) as real state — publishing asks even at maximum autonomy, secrets ask at every level, and universal denies survive any override. Lifecycle hooks shipped second: audit trails, guardrails that catch "claimed but vanished" files mid-run, and completion evidence — all deterministic, all in the same seq-ordered stream. 805 tests, +48 contract tests across the three pillars.

## What changed in v1.19.3

v1.19.3 — **Polish & Pulse** — from live user testing: the model picker's popover was literally transparent (undefined `--ink-950` token); health dots now pulse via a real heartbeat endpoint sweeping up to 12 models; upgrades no longer reset the user's model pick (migration backfills from the legacy row); full reasoning-effort ladder (off → ultra) exposed in Control Center and injected into completions only when not 'default'; and the chat-swallows-answers bug was root-caused once more — task_complete was still offered as a chat tool, inviting exactly the behavior the prompt forbade. Sidebar gained collapse/expand + drag-resize (persisted). Work surface got the same viewport fix and an explicit exit link.

## What changed in v1.19.2

v1.19.2 — **The Listener** — every defect reported after the 1.19.1 update, fixed with evidence: sessions open correctly again (a double-viewport layout bug pushed the whole thread view below the fold), model selection now persists across restarts (the reported 'lost my model' was an unpersisted picker recomputed to first-enabled), the composer's model picker gained search and per-model health dots (green verified / amber unverified / red known-incompatible) fed by the governed-run probe, the terminal got its missing xterm stylesheet (it rendered as overlapping unstyled text), and provider quick-start presets (OpenAI, Anthropic, Gemini, DeepSeek, OpenRouter, z.ai, Groq, Mistral, Ollama) prefill connections while custom endpoints and single-model imports stay first-class.

## What changed in v1.19.1

v1.19.1 — **The Answer Keeper** — fixes the worst live-reported defect: chat mode streamed a full 2,405-char answer and then replaced it with a 247-char procedural summary (the build-mode contract leaking into chat). Chat now has its own prompt contract, the verbatim streamed answer is persisted as the message of record, the client no longer appends a contained terse duplicate, Ctrl+K searches sessions as promised, unicode glyph icons became a real inline SVG set, and the empty-state rhythm no longer pushes the composer below the fold. 13 regression tests pin every layer.

## What changed in v1.19.0

v1.19.0 — **Alive** — the first-open release, and the first with an outside contributor (@malekradwan1300's UI rebuild v2: Hermes-inspired unified workspace, multi-provider catalog, Skill Hub discovery). On top of it: *Watch a governed run — no setup* (a 24-event recorded run replays the full loop through the real components — inspect, plan, approve, build, verify — no API key needed), a provider health probe that tells you honestly when a provider serves Chat but fails Planning/Build (stream+tools), the decision event as a first-class timeline row, and contract tests pinning all of it. 38 files / 744 tests.

## What changed in v1.18.0

v1.18.0 — **The Hardening Release** — closes every defect a live deep-inspection session plus a full code review could prove: the consecutive-empty-response counter actually resets (three scattered empties no longer kill a productive run), `python()` execution is rewritten to fs-written snippets with per-platform interpreter resolution (the printf path never worked on cmd.exe — our primary desktop target), mid-batch credit failures close their audit events instead of leaving dangling tool_calls, Arabic autonomy-violation detectors bring language parity to the build-mode guards, and a new security-model document states each layer's claim boundary with denylist bypass classes written down verbatim. 6 files / 715 tests.

## What changed in v1.17.0

v1.17.0 — **Stop, Classify, Trust** — real run cancellation (AbortController propagation into the provider stream, terminal-status `cancelled`, event-trailed), the browser policy unified across both enforcement layers with a lockstep contract test, and the typed capability manifest that future policy tooling derives from. Follows the first real live-model runs. 34 files / 699 tests.

## What changed in v1.16.0

v1.16.0 — **The Real-Model Release** — fixes everything the first genuine Opus 5 field test surfaced: the agent's triple-posted message (three compounding layers, all ours), reasoning models' thinking finally rendered (ThinkingBlock on Chat and Work), and nudge copy that treats the model like a colleague who already read the answer. 32 files / 681 tests.

## What changed in v1.15.2

v1.15.2 — **Product Language** — intent badges and the "Intent classified" timeline row now speak human words (`needs your choice`, not `clarification_needed`) on every surface, and the Xeo Flow trail no longer clips under the tabs. From the owner's screenshot audit.

## What changed in v1.15.1

v1.15.1 — **The Forge Identity** — de-templates the visual language: warm charcoal + ember orange replace the default acid-cyan dev-tool look, a heat-thread signature marks live/decision surfaces, failed runs become incident cards, and empty states become directional invitations. Driven by a 13-capture independent vision-model audit in both themes; post-fix scores 8-9/10.

## What changed in v1.15.0

v1.15.0 — **The Workbench Redesign** — the first structural redesign: a sidebar workbench shell replacing the top nav, a centered hero intake with an elevated composer card, and README screenshots captured from the current product instead of the v1.4.0 era. Independent vision-model design review: intake 8.2/10, dark workbench 9/10 ("rivals the polish of Linear or Cursor").

## What changed in v1.14.0

v1.14.0 — **Trustworthy Speed** — parallel read-only tool execution, terminal cleanup wired to run termination (a documented contract that had zero call sites since inception), the OpenHands competitive analysis and market position, a capability strip on the Work intake, and a README restructured to lead with the product. 32 files / 678 tests.

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
