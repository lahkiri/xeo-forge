# Xeo Forge Desktop for Windows and Linux

Xeo Forge ships a thin local desktop shell for users who want an installable Workbench with local persistence, a supervised Go runtime broker, an optional user-controlled browser, and air updates. The web control plane remains the product surface: the desktop shell does not duplicate task governance, context compilation, authentication, or persistence.

## Supported packages

| Platform | Package | Update path |
|---|---|---|
| Windows x64 | NSIS per-user installer | Air updates through the GitHub release feed after the OTA Bootstrap is installed. Restart installs unattended and opens the updated app. |
| Linux x64 | AppImage | AppImage can use the Electron update feed when launched as an AppImage. |
| Linux x64 | deb | Manual package installation; use the latest published package for upgrades. |

The Linux AppImage is the preferred Linux package when air updates matter. The deb package is provided for distributions and workflows that prefer native package installation, but it is not treated as an AppImage updater client.

## Build prerequisites

Node.js 20+, npm, and Go 1.22+ are required for the preparation step. Windows NSIS packaging runs on a Windows CI runner. Linux AppImage and deb packaging runs on Ubuntu CI.

```bash
npm ci
npm run desktop:prepare
npm run desktop:build:win
npm run desktop:build:linux
```

Artifacts are emitted under `dist/`. The Windows installer is named `Xeo-Forge-Setup-<version>-x64.exe`; Linux artifacts use `Xeo-Forge-<version>-x64.AppImage` and `Xeo-Forge-<version>-x64.deb` naming.

## OTA Bootstrap and upgrade continuity

The v1.3.0 installer predates the desktop updater and cannot update itself. **v1.3.1 is the minimum recommended installed version for receiving air updates.** Users should always update to the newest published version. A v1.3.1 installation is a one-time OTA Bootstrap; after it has been installed, later compatible releases can be discovered and downloaded from inside Xeo Forge.

The Windows v1.4.0 installer introduced the per-user one-click NSIS configuration. **v1.4.1 tightens the Restart to update path** by launching the downloaded installer through one explicit unattended path, disabling the secondary install-on-quit hook, and requesting direct relaunch after installation. The continuity gate still requires a real installed-device test from v1.4.0 to v1.4.1: discovery, user-approved download, restart, version change, and preservation of the SQLite database, Local Owner, settings, task history, and project path.

The updater stores only local state under Electron `userData`; it does not send telemetry. A release is not OTA-verified merely because electron-builder generated an installer, `latest.yml`, and a blockmap. Linux AppImage verification uses `latest-linux.yml`; deb installations are upgraded by installing the latest package.

Before distributing a production installer, add a Windows code-signing certificate, set an explicit update channel, keep the broker and Browser Bridge bound to `127.0.0.1`, and record SmartScreen behavior. The installer should be built in CI from a clean checkout so native dependencies and the SQLite database are not accidentally bundled from a developer machine.

## Browser Bridge and Browser Profiles

Browser access is optional and local-first. The user loads the bundled Chromium Manifest V3 extension into the browser profile they choose, pastes the local token shown in Control Center, and gives the profile a recognizable name such as `Work Chrome` or `Edge Personal`. The extension connects only to `127.0.0.1`.

Each extension installation announces a stable local browser profile identifier. Control Center lists connected profiles and the active tab, selects the profile used by Work, and persists that selection in Electron `userData`. A second browser connection never silently replaces the selected browser. If the selected profile disconnects, browser actions fail closed and the UI asks the user to reconnect or choose another profile.

`state`, `read_page`, and `screenshot` are the v1.4.0 read-only Browser Bridge core. Navigation, clicks, typing, form submission, domain allowlists, sensitive-action confirmation, and redaction remain separate hardening work. Connecting an extension or selecting a profile does not grant interaction permission.

See [`docs/browser-profile-v1.4.0.md`](../docs/browser-profile-v1.4.0.md) for the runtime contract and acceptance criteria, and [`browser-extension/README.md`](browser-extension/README.md) for the manual extension setup.

## Local development

```bash
npm run desktop:dev
npm run browser:smoke
```

The packaged app uses port `3100` for the production Next server, `4317` for the loopback runtime broker, and `4321` for the Browser Bridge. Set `XEO_APP_PORT`, `XEO_RUNTIME_PORT`, or `XEO_BROWSER_PORT` when those ports are already in use.
