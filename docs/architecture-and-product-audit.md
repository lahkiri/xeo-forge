# Xeo Forge — Product, UX, and Runtime Audit

## Executive direction

Xeo Forge should become a **local-first control plane for agentic work**: a calm operator workspace that makes intent, authority, evidence, and outcomes visible. The product should not become a collection of disconnected agent features. Every surface should answer four questions: what is the agent trying to do, what is it allowed to do, what has it done, and what evidence supports the result.

## Current strengths

- Approval-first execution and governed run identity already exist in the task model.
- Persistent memory, pinned instructions, reusable profiles, and skills provide a credible control-plane foundation.
- The workspace and preview subsystems expose real execution rather than a chat-only abstraction.
- Next.js standalone output and the SQLite/PostgreSQL adapter give a reasonable path for self-hosted and hosted deployments.

## Current gaps

- The Dashboard is a narrow form followed by a flat task list. It does not yet behave like an operator command center: there is no clear recent-run summary, control-layer summary, or visual distinction between starting work and monitoring work.
- Profile and Skill selection are compact native selects. They hide the behavioral consequences of a selection and make the most important governance decision look like a minor form field.
- The task screen contains strong primitives but is dense. Plan, execution evidence, context, files, preview, and follow-up actions need stronger information hierarchy and more explicit state language.
- Prompt Studio is functionally capable but reads like a settings form. It should become a Control Center with clear scopes, activation states, proposal review, and a compiled-context preview.
- The design system is minimal: only Button, Card, and StatusBadge exist. A product-level visual language needs tokens, typography hierarchy, surfaces, badges, tabs, empty states, banners, and responsive layout primitives.
- There is no Windows packaging layer. The current standalone Next.js server can be wrapped, but native SQLite requires an explicit packaging/rebuild strategy.

## Recommended runtime boundaries

### Keep in TypeScript/Node

Keep the product server, API routes, database adapter, agent orchestration, SSE, and OpenAI-compatible streaming in TypeScript. These areas are tightly coupled to Next.js, request/session semantics, schema types, and rapid product iteration. Rewriting them in Go would increase surface area without a demonstrated performance benefit.

### Extract to Go first

The first Go service should be a **local runtime broker** for preview and process lifecycle management. It is the clearest boundary because `lib/agent/preview.ts` owns child processes, port allocation, readiness probes, log capture, TTL cleanup, and cross-platform process concerns. A small loopback HTTP service can expose analyze/start/status/logs/stop endpoints and run as a Windows-friendly companion binary.

The Go broker should not own the database or agent policy. It should receive an explicit, validated launch specification from Node and return structured evidence. This keeps policy and permissions in the control plane while moving OS process work to a runtime that is easier to cross-compile and supervise on Windows.

### Consider later, only with measurements

- A Go file-indexing or workspace snapshot service may be worthwhile if profiling shows large repositories are slow.
- A Go task queue or event broker is premature while the existing SSE and database model are single-process.
- Rewriting context compilation, CRUD queries, or UI code in Go is not recommended.

## Windows strategy

Use a **desktop shell around the existing standalone Next.js app** as the first delivery path. The shell should start the local server on an available loopback port, wait for a health response, open a native window, and shut down the child process cleanly. The first implementation can use Electron because it is the lowest-risk wrapper for a Next.js server and supports Windows installer generation. The packaging configuration must rebuild `better-sqlite3` for the Electron runtime and include the standalone server plus static assets.

A later Wails/Tauri migration can be evaluated after the local runtime broker is stable. It should not be the first step because it would introduce a second desktop architecture while the application still needs UX work.

## Delivery order

1. Establish design tokens and a shared application shell.
2. Redesign Dashboard around “Start work” and “Recent runs”.
3. Redesign the governed task surface around state, evidence, and next action.
4. Reframe Prompt Studio as Control Center and add compiled-context visibility.
5. Add Windows packaging scripts and a smoke-test path.
6. Introduce the Go runtime broker behind a feature flag with a Node fallback.
7. Benchmark preview startup, readiness detection, and repository analysis before deciding whether to expand Go usage.

## Non-negotiable quality gates

- No change may bypass approval or expose a new execution capability implicitly.
- The Node fallback must remain available while the Go broker is experimental.
- Windows packaging must not expose secrets to the renderer.
- Every new runtime boundary needs typed request/response contracts and integration tests.
- Existing typecheck, tests, build, and `git diff --check` remain required before publishing to `master`.

## External platform findings

Electron's official packaging guide describes Electron Forge as the packaging/distribution layer and supports Windows distributables such as MSI; it also recommends code signing for trusted distribution [1]. Wails' official documentation describes a Go plus web-technology desktop model, native WebView2 on Windows, JavaScript-to-Go interoperability, and production-ready bundled binaries [2].

For Xeo Forge, this supports a staged decision: use an Electron wrapper first only if the existing Next standalone server must be shipped with minimal architectural change; evaluate Wails after the local Go runtime broker is proven, because Wails is a stronger long-term fit for a Go-native desktop shell but would require a deliberate bridge between the existing Next server and the desktop runtime.

### References

[1]: https://www.electronjs.org/docs/latest/tutorial/tutorial-packaging — Electron, “Packaging Your Application”.
[2]: https://wails.io/docs/introduction/ — Wails, “Introduction”.
