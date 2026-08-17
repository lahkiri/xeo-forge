# Xeo Forge for Windows

Xeo Forge keeps the web control plane as the product surface and adds a Windows shell for users who want a local, installable workspace. The desktop build starts the production Next server on loopback, opens it in a hardened Electron window, and starts the Go runtime broker as a sibling local process.

## Why this shape

The desktop shell is intentionally thin. It does not duplicate product logic, authentication, or task orchestration. That means the web version and Windows version share the same Workbench, Control Center, task governance, and persistence behavior.

Go is limited to the native runtime boundary: supervising local preview and worker processes with low startup overhead and an explicit executable/argument contract. Agent reasoning and context compilation stay in TypeScript because those surfaces are product behavior, not a measured native bottleneck.

## Build prerequisites

Node.js 20+, npm, and Go 1.22+ are required for the preparation step. A Windows CI runner is recommended for producing a signed NSIS installer. The Linux development environment can still cross-compile the broker and validate the Electron packaging configuration.

```bash
npm ci
npm run desktop:prepare
npm run desktop:build:win
```

The installer is emitted under `dist/` as `Xeo-Forge-Setup-<version>-x64.exe`.

## Local development

```bash
npm run desktop:dev
```

The app uses port `3100` for the packaged Next server and `4317` for the loopback runtime broker. Set `XEO_APP_PORT` or `XEO_RUNTIME_PORT` when those ports are already in use.

## Release hardening

Before distributing a production installer, add a Windows code-signing certificate, set an explicit update channel, and keep the broker bound to `127.0.0.1`. The installer should be built in CI from a clean checkout so native dependencies and the SQLite database are not accidentally bundled from a developer machine.
