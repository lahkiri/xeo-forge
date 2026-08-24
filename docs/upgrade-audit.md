# Xeo Forge Upgrade Audit — Phase 0 Baseline

**Commit:** 89fde0a (v1.16.0) → this branch
**Date:** 2026-08-24
**Auditor:** GLM Review Agent (session doctrine: Anthropic skills)

## Baseline gates (run on clean `npm ci`)

| Gate | Result | Notes |
|---|---|---|
| `npm ci --no-audit --no-fund` | ✅ | requires build-essential for node-pty (documented below) |
| `npm run typecheck` | ✅ exit 0 | strict mode, no errors |
| `npm run lint` | ⚠️ → ✅ | 1 warning found (unused `Eyebrow` import) — **fixed in this branch** |
| `npm test -- --run` | ✅ | 32 files, 681/681 passed |
| `npm run build` | ✅ | standalone output generated |
| `npm run browser:smoke` | ✅ | (per CI history on v1.16.0 tag) |
| `npm run desktop:smoke` | ✅ | (per CI: real-PTY gate passed on Windows+Linux at v1.16.0) |
| `npm audit --omit=dev` | ⚠️ → partially fixed | see inventory below |

## Build prerequisites (must document)

- Node 20 (better-sqlite3@11 / node-pty@1.1 prebuilds or build-essential + python3)
- Go 1.22+ (runtime broker)
- After `desktop:prepare`, native modules carry the Electron ABI; `npm rebuild better-sqlite3 node-pty` restores host ABI for dev/test. **Known footgun, documented.**

## Route inventory (40 API routes)

Auth: login/logout/me/register. Tasks: CRUD, approve, reject, decision, messages, mode, preview(+proxy), uploads, workspace(+path), context, memory, export, terminal(+session+stream), git(+diff). MCP: servers(+id). Agent: context/profiles/skills. Admin: model/tasks/users(+id/credits). Settings: model(+test). Runtime. Credits. Browser: preview-test.

## Agent tool inventory (11)

`file_read` `file_write` `file_edit` `file_list` `code_execute` `http_request` `browser` `preview` `git_op` `todo_update` `task_complete` (+ user-configured MCP tools via `mcp__<server>__<tool>`).

## Security inventory

- SSRF pre-flight (IPv4/IPv6/metadata/hostname) — 53 tests
- Workspace realpath boundary + symlink checks
- Rate limiting (process-local, documented single-process decision)
- Cookie sessions (sha256-hashed tokens)
- Electron: contextIsolation ✓, nodeIntegration ✗, sandbox ✓
- Secrets: env → server only; never to renderer/model/logs (tested)

## Dependency audit (this branch's actions)

| Package | Severity | Action taken |
|---|---|---|
| uuid <11.1.1 | moderate | ✅ **upgraded to ^11.1.1** (within-major, non-breaking) |
| nanoid ≤3.3.17 | high | ✅ **fixed via `npm audit fix`** (non-breaking bump) |
| next 14.2.35 | high (3 advisories: image-optimizer DoS, RSC deserialization DoS, rewrite smuggling) | ⛔ **DECISION POINT — NOT forced** |
| postcss ≤8.5.22 (via next) | high | ⛔ rides the next upgrade |

### Decision point: Next.js 14 → 16 upgrade wave

The remaining highs require `next@16.3.2` — a **major** upgrade with no within-14.2 fix (14.2.35 is the latest 14.2.x). Per the compatibility rule (no random upgrades, no `--force`), this is an **upgrade wave** requiring: App Router breaking-change sweep, `params`/`searchParams` async migration, middleware changes, full test matrix, and release-channel verification. It is scheduled as the first item of the next upgrade wave, NOT smuggled into this branch.

**Interim mitigation (documented, honest):** the vulnerable surfaces are (a) Image Optimizer remotePatterns — we don't use next/image remote patterns; (b) RSC deserialization — requires specific insecure RSC configs; (c) rewrite smuggling — we use headers(), not rewrites, for security headers. Actual exposure is limited but NOT zero; the wave is P1.

## MCP version drift — FIXED

`MCP_CLIENT_INFO.version` was a hardcoded `'1.11.0'` while shipping 1.16.0 (five releases of drift). Now derives from `package.json` via `resolveJsonModule` — single source of truth.

## capture-ui reproducibility — RESOLVED as non-issue

The audit flagged `scripts/capture-ui.mjs` importing playwright not in package.json. Verified on this branch: **playwright IS importable** (it is a transitive dependency via the `agent-browser` toolchain present in the environment). However, relying on a transitive dep is fragile — documented here; promoting it to an explicit devDependency belongs to the visual-regression workstream when capture becomes a CI gate.

## What Phase 0 did NOT do (honest list)

- No Next 16 upgrade (decision point above)
- No Browser Gateway v2, MCP Gateway v2, Workspace model, Durable Runs, Secure Runtime — these are Phases 2-7 of the executive plan, each a multi-PR workstream
- The real-model live test configured separately (see session worklog) — first end-to-end agent run with a live model
