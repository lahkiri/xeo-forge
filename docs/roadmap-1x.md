# Xeo Forge 1.x Roadmap

Xeo Forge uses a two-speed release model. Development may move quickly on `master` and through Preview releases, while Stable releases advance only after compatibility, upgrade, and data-preservation gates pass. The roadmap describes product milestones, not a promise that every milestone is delivered on a fixed calendar date.

## Operating model

| Surface | Default channel | Purpose |
|---|---|---|
| Desktop Local | Stable | Reliable local agent workbench with no SaaS account, credits, billing, or Admin dependency. |
| Desktop Local | Preview | Opt-in testing of upcoming desktop capabilities and release candidates. |
| Web SaaS | Stable web deployment | Multi-user SaaS surface with authentication, credits, model administration, and tenant-scoped task history. |

A development commit is not automatically a user-facing release. Patch releases such as `1.7.1` and `1.7.2` are appropriate for compatibility-preserving fixes. A milestone such as `1.8.0` is published only after its capability contract and release gates are complete.

## Milestones

| Version | Milestone | Scope | Stable acceptance focus |
|---|---|---|---|
| `v1.5.0` | Surface-Aware Workbench | Desktop Local/Web SaaS separation, Local-first navigation, local runtime guards. | No SaaS artifacts on Desktop Local; Web SaaS remains intact. |
| `v1.5.1` | Local Control Center and OTA cycle | Local model settings, persisted updater state, configurable channel and checks. | Settings survive restart; update state is understandable and non-destructive. |
| `v1.6.0` | Governed Browser Safety | Read-only-by-default browser bridge, domain allowlist, sensitive-action confirmation, redaction. | Unsafe browser operations fail closed at server, bridge, and extension boundaries. |
| `v1.7.0` | Memory Foundation | Canonical memory proposals, review/pin lifecycle, context injection for active memories, expiration. | Proposed and expired memories are excluded from active context; approved memories survive restart and upgrade. |
| `v1.8.0` | Agent Evolution and Model Routing | Stronger task/context instrumentation, explicit model capability routing, and local configuration controls that do not duplicate persistence. | Existing tasks remain resumable; model settings stay masked and compatible; routing is observable and deterministic. |
| `v1.9.0` | Browser Computer | Expand governed browser work from request-level bridge calls into a reliable inspect/act loop with explicit navigation and write boundaries. | Every browser action remains policy-checked, auditable, and recoverable after disconnect or restart. |
| `v1.10.0` | Agent Operating Environment | Integrate local workbench, governed browser, persistent context, model routing, updater channels, and auditable execution into one coherent operating environment. | A fresh install, upgrade, restart, and recovery preserve user data and established safety contracts. |

## Compatibility contract

Each milestone must preserve the following contracts unless a release note explicitly declares a migration and provides a tested path:

1. The local SQLite database and Electron `userData` remain readable after upgrade.
2. Local Owner state, project state, Browser Profiles, model settings, and updater state are preserved.
3. Desktop Local does not require Web SaaS authentication, credits, billing, multi-user state, or Admin routes.
4. Web SaaS keeps its authenticated account, credit, and Admin behavior.
5. Browser operations remain fail-closed when the bridge is disconnected, the domain is not allowed, the action is write-capable without confirmation, or redaction cannot be applied.
6. The single canonical persistence path remains authoritative for tasks, messages, memories, instructions, events, and model settings.
7. Existing OTA feeds remain valid: Stable uses `latest.yml` and `latest-linux.yml`; Preview uses `beta.yml` and `beta-linux.yml`.

## Release gates

A release candidate must pass all automated gates before promotion:

| Gate | Required evidence |
|---|---|
| Static correctness | `npm run typecheck` and `git diff --check` pass. |
| Application tests | `npm test -- --run` passes, including regressions for the milestone. |
| Web build | `npm run build` completes without ignored type or build errors. |
| Desktop behavior | `npm run desktop:smoke` passes for Local Owner, runtime, chat/work routing, and persisted state. |
| Browser behavior | `npm run browser:smoke` passes for profile selection, disconnect fail-closed, allowlist, redaction, and sensitive gates. |
| Distribution integrity | The channel-specific validator confirms installer, package, feed, path, size, and SHA-512. |
| Upgrade proof | A real installed previous version discovers, downloads, restarts unattended, opens the new version, and preserves local data. |
| Preview promotion | Preview runs on Windows and Linux CI and remains a non-Latest GitHub prerelease before Stable promotion. |

## Explicit non-goals

The 1.x roadmap does not introduce subagent teams, a marketplace, plugins, an analytics platform, a monitoring platform, a general permission framework, or duplicate persistence layers. A capability belongs in a milestone only when it completes the end-to-end path from user intent through agent execution, tools, persistence, and UI.

## Current position

`v1.7.0` is the current Stable milestone after Preview validation on Windows and Linux. The next development line is `v1.8.x` Preview work. Stable users should remain on the Stable channel unless they intentionally opt into Preview from the local Control Center.
