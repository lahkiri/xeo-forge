# Xeo Forge Local Browser Bridge

This optional Chromium extension lets Xeo Forge inspect the browser the user explicitly connects. It is designed for local visual QA, web research, and testing a project running on the user's machine.

## Privacy contract

The extension connects only to `ws://127.0.0.1:<port>` inside the user's computer. Page text, screenshots, cookies, and browser sessions are not sent to Xeo Forge servers. The bridge uses a per-installation token stored in the desktop app's `userData` directory.

The default capability is read-only: active-tab state, visible page text and links, and a visible screenshot. Page text is redacted by default for common emails, card numbers, phone numbers, and token-like strings. Navigation, clicking, and typing can be enabled only from **Control Center → User-controlled browser** by turning on interaction, adding an explicit domain allowlist, and saving the policy. Clicking and typing additionally require `confirmSensitive: true` on each agent action. An empty allowlist always blocks write actions. The policy is enforced by the desktop bridge and checked again by the extension.

## Install

1. Open Xeo Forge Desktop and go to **Control Center → User-controlled browser**.
2. Click **Open extension folder**. Browser safety is configured in Xeo Forge Control Center; the extension options page is only for its local token, port, and profile name.
3. In Chromium, open `chrome://extensions`, enable **Developer mode**, and choose **Load unpacked**.
4. Select the opened `browser-extension` folder.
5. Open the extension's options, paste the token shown by Xeo Forge, and save.

The extension reconnects automatically when Xeo Forge is running. Removing the extension or disabling it immediately stops the bridge connection.
