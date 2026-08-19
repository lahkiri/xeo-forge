# OTA test run — 2026-08-19

## Candidate release

- Release: [Xeo Forge v1.3.2](https://github.com/lahkiri/xeo-forge/releases/tag/v1.3.2)
- Tag: `v1.3.2`
- Commit: `166cce5a6842cc13238ce14ca87b907e39062f28`
- Windows CI run: [32210422108](https://github.com/lahkiri/xeo-forge/actions/runs/32210422108)
- CI result: success. Application tests, desktop preparation, Electron smoke, installer build, metadata verification, and artifact upload passed.
- Installer: `Xeo-Forge-Setup-1.3.2-x64.exe`, 135,123,018 bytes.
- Metadata: `latest.yml`, 355 bytes.
- Blockmap: `Xeo-Forge-Setup-1.3.2-x64.exe.blockmap`, 142,517 bytes.

## Intended real-device test

The user has manually installed v1.3.1. The next test is to open v1.3.1, use the in-app updater to check for v1.3.2, approve download, restart, and verify the new version plus preservation of Electron `userData`, SQLite, Local Owner, model settings, task history, and selected project path.

This release is an OTA verification candidate only. It is not v1.4.0 and does not claim Browser permissions, domain allowlisting, sensitive actions, ClarificationCard, Strict Local, redaction, code signing, or SmartScreen hardening are complete.
