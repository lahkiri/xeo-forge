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

## OTA Bootstrap and release hardening

The v1.3.0 installer predates the desktop updater and cannot update itself. The first updater-enabled build is a manual **OTA Bootstrap** and must be installed once over v1.3.0. See [`docs/ota-bootstrap-protocol.md`](../docs/ota-bootstrap-protocol.md) for the continuity test and release gate.

The updater stores only local state under Electron `userData`; it does not send telemetry. A release is not OTA-verified merely because electron-builder generated an installer, `latest.yml`, and a blockmap. A real Windows test must verify discovery, user-approved download, restart, version change, and preservation of the SQLite database, Local Owner, settings, history, and project path.

Before distributing a production installer, add a Windows code-signing certificate, set an explicit update channel, keep the broker bound to `127.0.0.1`, and record SmartScreen behavior. The installer should be built in CI from a clean checkout so native dependencies and the SQLite database are not accidentally bundled from a developer machine.
