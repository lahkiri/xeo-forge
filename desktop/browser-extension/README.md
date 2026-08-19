# Xeo Forge Local Browser Bridge

This optional Chromium extension lets Xeo Forge inspect the browser the user explicitly connects. It is designed for local visual QA, web research, and testing a project running on the user's machine.

## Privacy contract

The extension connects only to `ws://127.0.0.1:<port>` inside the user's computer. Page text, screenshots, cookies, and browser sessions are not sent to Xeo Forge servers. The bridge uses a per-installation token stored in the desktop app's `userData` directory.

The default capability is read-only: active-tab state, visible page text and links, and a visible screenshot. Navigation, clicking, typing, and form submission remain blocked until an explicit interaction policy is implemented and granted by the user.

## Install

1. Open Xeo Forge Desktop and go to **Control Center → User-controlled browser**.
2. Click **Open extension folder**.
3. In Chromium, open `chrome://extensions`, enable **Developer mode**, and choose **Load unpacked**.
4. Select the opened `browser-extension` folder.
5. Open the extension's options, paste the token shown by Xeo Forge, and save.

The extension reconnects automatically when Xeo Forge is running. Removing the extension or disabling it immediately stops the bridge connection.
