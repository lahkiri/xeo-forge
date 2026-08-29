# v1.24 Structural Rework — Evidence Record

**Date:** 2026-08-29 · **Status:** rework complete and pushed, including the
maintainer-ordered dead-surface removal below; the v1.24.0 release itself was
explicitly authorized by the maintainer and follows this record.

This document records the v1.24 structural rework of the repo's three largest
source files, as identified by the Indxr MCP project map (v1.23.1 scan,
2026-08-28): `lib/agent/loop.ts` (1,917 lines), `lib/db/queries.ts` (1,476),
`app/work/WorkClient.tsx` (1,091). It complements the earlier structural audit
in `docs/audits/2026-08-26-radical-audit.md`.

**Governing law (held throughout):** test first → split → verify behavior
unchanged. Every extraction moved code verbatim; every redirect re-pinned
contracts on both sides (definition site + call site). The full suite was run
before and after every step, and each phase was pushed immediately.

## Phases

### Phase 1.1 — agent loop primitives (commit `3c7460b`)

`lib/agent/loop.ts` was 1,917 lines carrying five concerns inline. Five
modules were extracted verbatim into `lib/agent/run/`:

| Module | Role |
|---|---|
| `protocol.ts` | run protocol types and event contracts |
| `model-client.ts` | provider call/retry plumbing |
| `language.ts` | language/i18n of run messages |
| `memory.ts` | memory candidates (incl. `persistMemoryCandidates`) |
| `tool-bridge.ts` | tool dispatch bridging |

**Before → after:** 1,917 → 1,620 lines. Contract tests were redirected with
the double-sided pattern (`test/loop-guards.test.ts` fingerprint + parallel
batch, `test/v118-hardening.test.ts` F4) pinning `definitionSites.length === 1`
so duplication cannot silently return. A rebuilt end-to-end behavior suite
(`test/run-agent-behavior.test.ts`, 6 scenarios through a real DB + real
emitter against a mock OpenAI-compatible SSE provider) pins the run loop's
observable behavior across the extraction: chat finalize-on-first-text,
native reasoning events, inline `<think>` extraction, build-mode evidence
gate, honest 401 failure, and the `<action>` fallback path.

### Phase 1.2 — chat streaming resilience (previously shipped, verified)

`useTaskStream` and the SSE split-bus were verified intact during session
restore; no further changes were required in this rework.

### Phase 1.3 — Work surface decomposition (commit `4826fff`)

`app/work/WorkClient.tsx` (1,091 lines, one component + all state) was
decomposed into focused modules, moved verbatim:

- **Hooks:** `useWorkRunState`, `useWorkspaceDiff`, `useGitStatus`,
  `useWorkDerived`, `useWorkActions`, `useDecisionCountdown`, `usePendingMemory`,
  plus pure helpers in `work-ingest.ts`.
- **Components:** `WorkRunPane`, `WorkGovernanceRail`, `WorkCenterHeader`,
  `WorkSecondaryTabs`, `WorkDiffTab`, `WorkRunList`, `WorkComposer`.

**Before → after:** 1,091 → 216 lines. The DiffSink identity is memoized so
the SSE subscription happens once per task, never per render — the resubscribe
regression class is designed out, not just re-tested. Contract tests were
redirected double-sidedly (chat-hang H3 poll text, demo-replay pacer,
cancellation Cancel, ThinkingBlock). New `test/work-ingest.test.ts` (7
assertions). ESLint clean on all 21 touched files.

### Phase 1.4 — DB query package (commit `c5576a3`)

`lib/db/queries.ts` — the ONLY application-table writer, 1,476 lines and 71
exported functions — was decomposed into a re-export facade plus domain
modules under `lib/db/queries/`, moved verbatim:

| Module | Lines | Contents |
|---|---|---|
| `queries.ts` (facade) | 28 | re-exports only — zero SQL |
| `users.ts` | 111 | users & sessions (10 fns) |
| `tasks.ts` | 342 | tasks, decisions, plan approval (12 fns + type) |
| `events.ts` | 192 | task events & messages (6 fns) |
| `admin.ts` | 84 | model settings & admin actions (4 fns) |
| `credits.ts` | 26 | credits reads (writes stay in `lib/credits/engine.ts`) |
| `uploads.ts` | 122 | upload lifecycle (6 fns) |
| `context.ts` | 275 | instructions & memories (9 fns) |
| `profiles.ts` | 172 | profiles & skills (10 fns) |
| `providers.ts` | 207 | model providers (12 fns) |
| `shared.ts` | 20 | package-private helpers (nowIso, isUniqueViolation, normalizeMemoryContent) |

All 53 import sites stay untouched — `@/lib/db/queries` remains the only
sanctioned path. `test/db-queries-structure.test.ts` (7 assertions) pins the
structure double-sidedly: facade purity (no SQL), exactly-one definition site
per function, the pre-split export surface frozen, external db-adapter users
frozen to `{lib/credits/engine.ts, lib/mcp/registry.ts}`, deep domain imports
forbidden, shared helpers package-private.

### Phase 1.5 — dead-surface removal: `app/work/WorkIntake.tsx`

Discovered during the README media refresh: `WorkIntake.tsx` (438 lines) had
**zero production importers**. The `/work` route redirects to `/chat`
(`app/work/page.tsx`), so the intake page was unreachable, and the LIVE demo
entry lives in `app/chat/UnifiedWorkspace.tsx` (`POST /api/demo` →
`router.push('/work/<id>?demo=1')`) — WorkIntake was a dead duplicate of that
flow. Per the maintainer's explicit decision it was deleted in v1.24.

**Verification before deletion (comprehensive grep across every file type):**

- `WorkIntake` appears in exactly 5 places repo-wide: the file itself,
  the `intake wiring` describe of `test/demo-replay-contract.test.ts` (a
  source-reading pin, not an import), and three historical release-record
  documents (`docs/release-notes/v1.21.0.md`, `v1.23.0.md`,
  `docs/RELEASES.md`) which are left untouched as historical records.
- No import, no dynamic `import()`/`lazy()`, no barrel re-export, no
  tsconfig/next.config/script/workflow reference anywhere.
- Icon hygiene checked: the 4 icons it imported (`IconArrowRight`, `IconX`,
  `IconCheck`, `IconCircle`) remain used by 2–7 other files each — no
  orphans created.

**Removed with it:** the `intake wiring` describe block of
`test/demo-replay-contract.test.ts` (3 assertions that read WorkIntake's
source). The file's other four contract blocks — golden-run script integrity,
demo seed route, WorkClient pacer, decision-event rendering — pin LIVE
modules and stay. An in-file note records why the intake block is gone and
where the live demo entry actually lives.

**Verification after deletion:** full suite 50 files, 891/891 green
(894 − 3); `tsc --noEmit` clean; ESLint clean on the touched file.

## Before → after

| File | Before | After |
|---|---|---|
| `lib/agent/loop.ts` | 1,917 | 1,620 |
| `app/work/WorkClient.tsx` | 1,091 | 216 |
| `lib/db/queries.ts` | 1,476 | 28 (facade) + 9 domain modules |
| Test suite | 866 tests (47 files) | 891 tests (50 files), all green (866 → 894 through the splits; −3 dead-surface intake pins removed with WorkIntake) |
| `tsc --noEmit` | clean | clean |

Commits, in order: `3c7460b` (loop split) → `4826fff` (WorkClient) →
`4e1884b` (merge v1.23.1 Answer Keeper II, disjoint file sets, conflict-free)
→ `c5576a3` (queries package) → `f4f3f09` (AGENTS.md layout truth) →
`03c7e34` (evidence record) → the WorkIntake dead-surface removal.

## Honestly out of scope

- The v1.23 project map counted 93 functions above the complexity-15
  threshold across the repo. Line-count decomposition addresses the three
  largest files; cyclomatic-complexity debt inside the remaining functions
  (including `runAgent`) was **not** systematically attacked in this rework.
- No behavior change is claimed anywhere: this rework is structure only, and
  the 891-test suite pins exactly that claim.
