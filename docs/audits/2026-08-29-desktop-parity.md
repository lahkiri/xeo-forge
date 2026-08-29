# v1.25 Desktop-Parity Batch — Evidence Record

**Date:** 2026-08-29 · **Trigger:** daily real-world use of the DESKTOP build
showed it treated as a second-class citizen while the visual identity work
landed elsewhere. Every fix below was verified in the code first, then
proven — including LIVE evidence from the real Electron desktop runtime
(see the capture session at the bottom).

**Governing law (held throughout):** reproduce/diagnose → test-first where a
contract exists → fix → full suite → push immediately. Governance changes
went through the EXISTING structures (zone rules, fail-closed, bridge
policy) — no new parallel paths.

## Phase 3.1 — follow-up & decision paths never strand the operator

The live report "follow-up works only after a failure" traced to THREE
concrete defects, each proven RED by `test/work-followup-contract.test.ts`
against the v1.24.0 code:

- **D1** `claimTaskForFollowUp` refused `cancelled` while the Work composer
  renders on every terminal status — cancel left a composer whose sends
  409ed with a lying "already running" message.
- **D2** `resolveTaskDecision` hard-rejected late decisions although its own
  doc said "the UI timer is only presentation". An expired direct-request
  window stranded the operator: gate unmounted, composer 409ed, decision
  409ed. The timer is now presentation-only; a late explicit choice
  resolves the card and the audit event records `decided_late` honestly.
  Expiry still never defaults to execution.
- **D3** the work client ignored terminal `task_status` events waiting for
  `done`; a lost done event left the surface stuck on "running". The row is
  the truth — terminal transitions are adopted now.

## Phase 3.2 — in-session model switch + audit event

`POST /api/tasks/[id]/model` validates ownership/pairing/enabled state,
refuses a live run (credentials resolve once per run — the in-flight run
keeps its loaded provider, no mid-run swap), updates the row, and appends a
`model_switch` audit event (old → new, timestamped, registered on the work
surface with a timeline label). The governance rail carries the switcher,
locked honestly while a run is live. `test/model-switch.test.ts`.

## Phase 2 — provider & model editing

The API always had PATCH provider + PATCH/DELETE single model — the UI
never exposed them (only Pause + Delete). ProvidersManager now has Edit for
providers (name, base URL, write-only key field: blank keeps the stored
key; the raw key never round-trips — `api_key_set` is the only client
signal) and Edit per model row. Live-session safety is architectural and
now stated in the UI. Add-model-by-hand and per-model delete already
existed and were verified live in the capture.

## Phase 1.2 — real session titles + temporal discrimination

The live report: a sidebar where every thread was literally titled with the
raw first message. Deterministic titles (no model spend): real openers
become word-boundary, bidi-safe truncated titles; greeting-only openers
stay NULL until the first assistant answer fills them
(`refreshSessionTitle`, single-shot). Legacy rows fall back through the
same truncation; the sidebar adds today/yesterday/date.
`test/session-titles.test.ts` (10).

## Phase 1.1 — frameless window + custom titlebar

`frame: false` (Windows and Linux share the same main process) +
`components/DesktopTitleBar.tsx`: brand + title + min/max/close from the
SAME icon vocabulary and tokens; the bar is a drag region; maximize state
is published; controls go through IPC as the only path; renders null on
web. **Bonus defect found live:** `npm run desktop:dev` was UNBOOTABLE —
the dev server path pointed at the Next app-router directory instead of
`.next/standalone/server.js`. Fixed.
`test/desktop-titlebar.test.ts` (6).

## Phase 5 — Settings sections + the standing rule

Settings 07 "Sandbox" (tier cards rendered VERBATIM from the executor's own
SANDBOX_MODES via /api/sandbox + live Docker probe + honest install steps)
and 08 "Subagents" (inheritance, read-only construction, sub-N attribution,
bounded iterations, and the disclosed write-delegation boundary).
AGENTS.md §17 now codifies: any governance-critical feature ships with a
visible Settings section from day one — never ONLY in a task-start form.
`test/settings-governance-sections.test.ts`.

## Phase 6.2 — browser bridge pairs by explicit approval

Diagnosis of "extension loaded but Not connected": (1) the extension
silently never connected without a pasted token — no error anywhere;
(2) a REAL reconnect bug — the close-event of an intentionally-closed
socket scheduled a reconnect that tore down the NEW healthy connection
every 2 seconds (the churn behind the flapping "Not connected").
Fixed: tokenless `/pair` WS path; the connection stays PENDING (never
commandable, capped at 4); the Runtime page shows a live approval card
(Agree/Deny); approval persists the browserId (0600) and reconnects are
auto-approved forever after; deny closes honestly. The manual token path
remains as the advanced option. `smoke-browser-bridge.mjs` now 13 checks.

## Phase 6.1 — preview failures + governed domain allowlist

The failed "Audit the code" task was a task-level failure, not a preview
defect — but the Preview tab HID the failure. A failed run now says so with
the classified reason from its own error event. The 127.0.0.1 preview proxy
is by design and stays. Allowlist expansion implemented consent-first: the
agent layer and bridge already enforce ONE policy; the missing piece was
UI — Runtime settings now carries a domain allowlist editor (external
browsing OFF by default; adding a bare hostname is an explicit operator
approval; removable chips).

## Phase 1.3 — design tokens: verified unified

`app/globals.css` is the ONLY stylesheet; the desktop renderer consumes the
same tokens by construction. The only desktop-specific chrome WAS the OS
frame — replaced by the tokened titlebar. No divergence existed to fix.

## Phase 4 + Phase 7 — honest status

- **Phase 4 (subagent expansion):** NOT DONE in this batch beyond
  documentation. Per-subagent follow-ups/model overrides require loop-level
  design; per the README's own rule (and the maintainer's instruction), a
  concurrent-write design must be documented before any code. The Settings
  section now states the boundary verbatim. Disclosed in README gap #6.
- **Phase 7 (split/collapse controls):** NOT DONE (lowest priority per the
  task itself). Disclosed in README gap #7.

## LIVE DESKTOP EVIDENCE (the real Electron runtime, not the web)

`scripts/desktop-live-capture.mjs` boots the actual Electron shell under a
virtual display, seeds through the live API, and captured six screenshots
(kept in `/download/desktop-evidence/`, out of the repo):

1. `01-desktop-titlebar-home.png` — custom titlebar (no OS frame), model
   picker in the composer, dark forge identity.
2. `02-sidebar-session-titles.png` — distinct titles ("Fix the flaky auth
   session test and ad…" stored; "اهلا" as the honest legacy fallback),
   today-labels, work entry with failed chip.
3. `03-work-decision-gate-model-rail.png` — a failed run showing its
   classified reason ("Connection error") + preserved-trail honesty, the
   follow-up composer PRESENT after failure, the governance rail with the
   MODEL section and its honest copy, authority rows live.
4. `04-settings-sandbox.png` — 07 Sandbox section live: three tier cards
   with the executor's verbatim descriptions, "Docker not detected" chip,
   structured install guidance, 08 Subagents in the nav.
5. `05-settings-runtime-pairing.png` — 3-step setup, pairing-first copy,
   manual token demoted to an advanced disclosure.
6. `06-settings-providers-edit.png` — provider-level Edit / Pause / Delete /
   Import models / + Add model actions, the write-only "API key: Configured"
   signal, and three seeded model rows each with Edit / Pause / Delete.
   **Correction (owner-ordered re-capture):** the ORIGINAL frame in this batch
   caught the catalog in its "Loading catalog…" state — the Edit affordances
   were not visible in it, and the entry above originally overstated what the
   frame showed. The re-capture (`scripts/recapture-06-providers.mjs`)
   hard-fails unless the provider row, the auto-selected detail pane, exactly
   3 model rows, and >=2 Edit buttons are all present, then captures — no
   silent catches, assertions verified before the screenshot is written.

## Verification totals

Suite 934/934 across 55 files (909 at batch start → +25 new assertions);
tsc clean; eslint clean; duplicate-attribute scans clean; browser-bridge
smoke 13/13; CI is the canonical gate for the final state.

Commits, in order: `abe7db1` (3.1) → `05034da` (2+3.2) → `70211d5` (1.2) →
`e83c928` (6.2) → `21786c3` (6.1) → `33c2ac7` (5) → `c8e18a3` (1.1) →
`72e9fef` (desktop:dev fix + evidence harness).
