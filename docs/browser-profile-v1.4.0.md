# Browser Profile Design for v1.4.0

## Purpose

Xeo Forge v1.4.0 includes the core Browser Bridge as a first-class Work capability. The user installs the Xeo Forge extension in the browser and browser profile they choose, connects it to the local desktop application, and selects that connection as the preferred browser for agent work.

The feature is a **local browser binding**, not a remote browser service. The desktop bridge listens only on loopback, the extension connects only to `127.0.0.1`, and the agent sends browser commands to the selected local connection. No browser connection is silently shared with another Xeo Forge installation.

## User model

The user experience is intentionally simple:

1. Open **Control Center → Browser Bridge**.
2. Open the bundled extension folder and load the unpacked extension in Chrome, Chromium, Edge, or another compatible Chromium profile.
3. Paste the local bridge token once, optionally name the connection, and save.
4. Xeo Forge displays the connected browser profile and its active tab.
5. The user selects **Use for Work**. The selection is persisted locally and survives application restarts.
6. Work and Chat browser inspection use the selected profile. If no profile is selected, or if the selected profile is disconnected, Xeo Forge refuses the browser action with a visible recovery message instead of silently using another browser.

When only one connection exists, the UI may offer a convenient selection action, but the bridge still persists the selected profile explicitly. When multiple connections exist, the bridge never uses last-connection-wins behavior.

## Runtime contract

The bridge maintains a registry of extension connections. Every extension installation creates a stable random `browserId` in `chrome.storage.local`. The extension announces the following registration data after the WebSocket handshake:

| Field | Meaning |
|---|---|
| `browserId` | Stable local identifier for the extension installation and browser profile. |
| `profileName` | User-editable label such as `Work Chrome` or `Edge Personal`. |
| `browserName` | Best-effort browser family label derived locally; it is informational only. |
| `extensionVersion` | Extension manifest version for troubleshooting compatibility. |
| `userAgent` | Local diagnostic metadata; it is not used for authorization. |
| `permissions` | Capabilities the extension currently exposes, beginning with `state`, `read_page`, and `screenshot`. |
| `tab` | The active tab metadata reported by that profile. |

The authenticated HTTP state response exposes the selected profile and all currently connected profiles. The command endpoint routes to the persisted preferred profile. An optional internal `browserId` may be used by the desktop selection handler, but the agent does not choose arbitrary profiles during a run.

The persisted preference contains only the selected local `browserId`; it does not contain cookies, page contents, credentials, screenshots, or browsing history. If a selected profile is absent after restart, the bridge reports `selected_disconnected` and requires the user to reconnect or choose another profile.

## Permission boundary

v1.4.0 ships the safe Browser Bridge core:

- `state` reports connection and active-tab metadata.
- `read_page` reads the current page through the extension.
- `screenshot` captures the current visible tab.
- Browser inspection is read-only by default in both Chat and Planning.

Navigation, clicks, typing, form submission, domain allowlists, sensitive-action confirmation, redaction, and write-capable browser workflows remain separately gated work for a later hardening milestone. The extension must not advertise those capabilities merely because the agent tool schema already contains their names. A browser connection or profile selection must never grant interaction permission by itself.

## Security and privacy invariants

The bridge remains bound to `127.0.0.1` and requires the per-installation random token for both HTTP and WebSocket requests. The extension does not send page data to a third-party service by itself; it sends data only to the local Xeo Forge process. The application may still pass a page excerpt or screenshot to the configured model provider when the user invokes an agent action, so the UI and documentation must distinguish **local browser transport** from the separate model-provider data path.

The bridge does not expose browser cookies, saved passwords, extension data, or arbitrary tab history. It operates on the active tab selected by the browser profile. A disconnected or unauthorized connection must fail closed, and pending commands for that connection must reject visibly rather than being rerouted to another profile.

## Compatibility and migration

Existing v1.3.x installations have a single browser token and no persisted browser profile. v1.4.0 treats the existing token as the installation token, creates a new local browser preference file on first use, and accepts an extension that has not yet generated a `browserId` by assigning one during its first handshake. No database migration is required for browser selection because the preference belongs to the desktop installation, not to task history.

The Browser Bridge remains optional. Xeo Forge without the extension continues to work; browser tools return a clear `bridge_not_configured` or `browser_selection_required` error and do not affect ordinary Chat or Work execution.

## Acceptance criteria

A v1.4.0 Browser Bridge build is complete only when all of the following are true:

1. A compatible extension can register with a local desktop installation using the existing token flow.
2. The desktop UI lists the profile name, browser label, active tab, permissions, connection status, and a clear selection action.
3. The selected profile persists across desktop restarts and is the only profile used by agent browser requests.
4. Connecting a second profile does not replace or silently steal the first profile's commands.
5. Disconnecting the selected profile produces a visible unavailable state and never falls back silently.
6. Read-only actions continue to work without interaction permission.
7. Navigation, clicks, typing, and submission remain rejected unless a later explicit permission design enables them.
8. Browser smoke tests cover token authentication, profile registration, selection, selected-profile routing, disconnect behavior, and unauthorized requests.

## Scope decision

The v1.4.0 release combines this Browser Bridge core with the Windows unattended OTA fix, Linux packaging, and updated release documentation. Advanced Browser permissions, domain allowlists, sensitive actions, clarification cards, Strict Local, and redaction are not silently folded into this release; they remain explicit follow-up milestones.
