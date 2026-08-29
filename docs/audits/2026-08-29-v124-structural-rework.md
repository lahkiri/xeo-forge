# v1.24 Structural Rework — Evidence Record

**Date:** 2026-08-29 · **Status:** rework complete and pushed; **not released** —
no tag, no version bump, no release notes. The release itself is a separate,
explicitly authorized step.

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

## Before → after

| File | Before | After |
|---|---|---|
| `lib/agent/loop.ts` | 1,917 | 1,620 |
| `app/work/WorkClient.tsx` | 1,091 | 216 |
| `lib/db/queries.ts` | 1,476 | 28 (facade) + 9 domain modules |
| Test suite | 866 tests (47 files) | 894 tests (50 files), all green |
| `tsc --noEmit` | clean | clean |

Commits, in order: `3c7460b` (loop split) → `4826fff` (WorkClient) →
`4e1884b` (merge v1.23.1 Answer Keeper II, disjoint file sets, conflict-free)
→ `c5576a3` (queries package) → `f4f3f09` (AGENTS.md layout truth).

## Honestly out of scope

- The v1.23 project map counted 93 functions above the complexity-15
  threshold across the repo. Line-count decomposition addresses the three
  largest files; cyclomatic-complexity debt inside the remaining functions
  (including `runAgent`) was **not** systematically attacked in this rework.
- No behavior change is claimed anywhere: this rework is structure only, and
  the 894-test suite pins exactly that claim.
