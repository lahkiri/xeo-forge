# Xeo Forge Release Channels

Xeo Forge separates development velocity from the update experience of stable users. Commits may land on `master` frequently, but users receive only the channel they explicitly select.

## Channels

| Channel | Feed | Intended audience | GitHub release state |
|---|---|---|---|
| Stable | `latest.yml` / `latest-linux.yml` | Everyday users | Normal release and marked Latest |
| Preview | `beta.yml` / `beta-linux.yml` | Developers and testers | Prerelease and never marked Latest |

Stable is the default. Preview is opt-in from the local Control Center and is not required for normal use.

## Version rules

Stable releases use normal SemVer tags such as `v1.7.0`, `v1.7.1`, or `v1.8.0`. Preview releases use prerelease tags such as `v1.7.0-beta.1`. A prerelease tag is built with `publish.channel=beta`, which produces `beta.yml` and `beta-linux.yml`; a stable tag is built with `publish.channel=latest`, which produces `latest.yml` and `latest-linux.yml`.

The release workflow determines the channel from the tag, runs the artifact validator for that channel, and creates prerelease GitHub releases with `--latest=false`. The workflow must fail before upload if the installer, blockmap, feed, size, or SHA-512 does not match.

## Update behavior

The Electron updater stores the selected channel, automatic-check preference, check interval, last check, and last error in the local `userData` directory. Changing the channel does not delete projects, SQLite data, Local Owner state, browser profiles, model configuration, or settings. Automatic checks are scheduled using the persisted interval; installation remains explicit through **Restart and install**.

Stable users must not be forced through Preview builds. Preview users may receive prereleases, but every Preview release must still pass typecheck, tests, production build, desktop/browser smoke tests, artifact verification, and an upgrade/data-preservation check before being shared.

## Release gates

A release is not considered valid merely because a build completed. The minimum gates are:

1. `npm run typecheck`.
2. `npm test -- --run`.
3. `npm run build`.
4. `npm run desktop:smoke`.
5. `npm run browser:smoke`.
6. `npm run verify:release:artifacts` for Stable or `npm run verify:release:artifacts:preview` for Preview.
7. A real installed upgrade check where the previous version starts, the update is discovered and downloaded, restart completes without a second setup wizard, and local data remains intact.

Development commits may be more frequent than releases. A milestone such as `v1.7.0` is published only after its feature contract and all release gates are complete.
