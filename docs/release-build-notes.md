# Release build notes

## Windows CI v1.1.0

Source: [GitHub Actions run 31993057727](https://github.com/lahkiri/xeo-forge/actions/runs/31993057727)

The workflow reached electron-builder successfully. The failure occurred during Windows packaging because electron-builder reported:

> image D:\\a\\xeo-forge\\xeo-forge\\desktop\\assets\\icon.ico must be at least 256x256

The run also emitted non-blocking warnings about forced Node.js 24 for actions targeting Node.js 20 and an unavailable Go cache file. The blocking issue is the ICO dimensions. The icon must be regenerated with a 256x256 image entry or larger before rerunning the workflow and creating the Release.

The run was triggered by tag `v1.1.0` at commit `9fcd04d`.

## Official release workflow

Workflow source: [windows-desktop.yml](https://github.com/lahkiri/xeo-forge/blob/master/.github/workflows/windows-desktop.yml)

Expected artifact: `dist/*.exe` uploaded as `xeo-forge-windows-installer`.

## Languages and boundaries

- TypeScript/React/Next.js: product UI, App Router pages, API routes, auth, database queries, agent orchestration, context compiler, SSE, and CRUD flows.
- Go: local runtime broker with health/contract endpoints and cross-platform native process boundary.
- JavaScript/CommonJS/ESM: Electron desktop shell and packaging preparation scripts.
- CSS/Tailwind: visual system and responsive presentation layer.
- YAML: GitHub Actions Windows build workflow.
- Python: development utility that generates the Windows ICO asset; not a runtime dependency.

## v1.5.0 — Surface-Aware Workbench

v1.5.0 separates the two supported product surfaces without removing the SaaS implementation. Web SaaS retains authentication, credits, hosted persistence, multi-user administration, and admin inspection. Desktop Local enters the workbench directly and hides account, billing, credits, multi-user, and admin concepts from its navigation and server responses.

The Local runtime now rejects Desktop Local access to `/api/credits` and `/api/admin/*`, skips local credit enforcement during task creation and agent execution, and keeps the internal Local Owner only for owner-scoping and persistence compatibility. The release also documents the minimum OTA Bootstrap version as v1.3.1 and keeps the unattended Windows restart path introduced in v1.4.1.

Verification completed on the release candidate:

| Check | Result |
|---|---|
| `npm run typecheck` | Passed |
| `npm test -- --run` | Passed |
| `npm run build` | Passed |
| `npm run desktop:smoke` | Passed: local redirect, implicit owner, disabled registration, Chat/Work decision flow, native runtime health |
| `npm run browser:smoke` | Passed: loopback auth, profile registration/selection/routing, explicit switching, fail-closed disconnect |
| `git diff --check` | Passed |

The release tag should use the annotated title **`v1.5.0 — Surface-Aware Workbench`** and the description above. Future release tags must always include both a human-readable title and a concise description of user-facing changes and verification status.

## Languages and boundaries

- TypeScript/React/Next.js: product UI, App Router pages, API routes, auth, database queries, agent orchestration, context compiler, SSE, and CRUD flows.
- Go: local runtime broker with health/contract endpoints and cross-platform native process boundary.
- JavaScript/CommonJS/ESM: Electron desktop shell and packaging preparation scripts.
- CSS/Tailwind: visual system and responsive presentation layer.
- YAML: GitHub Actions Windows build workflow.
- Python: development utility that generates the Windows ICO asset; not a runtime dependency.

## v1.5.1 — Local Control Center & Update Lifecycle

v1.5.1 restores the missing local control surface that was previously hidden when the SaaS Admin page was removed from Desktop Local. The Desktop Control Center now exposes the active OpenAI-compatible model, endpoint, masked API-key state, temperature, output-token budget, context window, and automatic compaction threshold. The API key is accepted only for local configuration updates and is never returned to the renderer.

The Desktop updater is no longer dependent on a single five-second startup check. It now persists update preferences and lifecycle state under Electron `userData`, supports stable/beta channels, configurable automatic-check intervals, manual checks, explicit download, progress reporting, downloaded-state recovery, error visibility, and the existing unattended Windows restart/install path. The updater keeps `autoDownload` and `autoInstallOnAppQuit` disabled so installation remains an explicit user action.

Verification completed for this patch:

| Check | Result |
|---|---|
| Electron `node --check` for main/preload/update-state | Passed |
| `npm test -- --run test/update-state.test.ts` | Passed: 4 tests |
| `npm test -- --run` | Passed |
| `npm run typecheck` | Passed |
| `npm run desktop:smoke` | Passed |
| `npm run browser:smoke` | Passed |
| `npm run build` | Passed |
| `git diff --check` | Passed |

The annotated release title is **`v1.5.1 — Local Control Center & Update Lifecycle`**. Future tags must continue to include a human-readable title and a concise description of user-facing changes and verification status.

## v1.6.0 — Governed Browser Safety

v1.6.0 makes the local browser capability governed instead of merely connected. Desktop Local keeps browser inspection read-only by default, while the Control Center now exposes an explicit local interaction policy. Navigation, clicks, and typing require interaction to be enabled and the target host to match the saved domain allowlist. Click and type additionally require sensitive-action permission and `confirmSensitive: true` on each tool call. An empty allowlist always fails closed.

Visible page text is redacted by default for common email addresses, payment-card-like numbers, phone numbers, and token-like strings. The policy is persisted under Electron `userData`, passed through the loopback bridge, enforced by the bridge before dispatch, and checked again by the browser extension. Web SaaS remains unchanged; these controls apply to the Desktop Local browser bridge only.

Verification completed for this milestone:

| Check | Result |
|---|---|
| Electron and extension `node --check` | Passed |
| `npm run typecheck` | Passed |
| Browser policy unit tests | Passed: 2 tests |
| Browser regression tests | Passed: 2 tests |
| `npm test -- --run` | Passed |
| `npm run desktop:smoke` | Passed |
| `npm run browser:smoke` | Passed: read-only default, allowlist rejection, sensitive-action confirmation, profile routing, fail-closed disconnect |
| `npm run build` | Passed |
| `git diff --check` | Passed |

The annotated release title is **`v1.6.0 — Governed Browser Safety`**. Future tags must continue to include a human-readable title, a user-facing description, and verification status.
