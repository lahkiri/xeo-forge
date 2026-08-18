# Desktop Local Mode

Xeo Forge Desktop opens as a local workbench. It does not require a registration form, email, password, or cloud account in order to operate on the user’s machine.

## Runtime contract

When Electron starts the bundled Next.js server, it sets `XEO_DESKTOP_LOCAL=1` and points `DB_PATH` to the application user-data directory. The server then creates the canonical SQLite schema on demand and resolves one implicit owner, `local-owner@xeo-forge.local`, for all protected routes. This owner is an internal workspace identity, not a cloud account and not a usable login credential.

The root route opens the Workbench directly. `/login` and `/register` redirect to `/dashboard` in Desktop Local Mode, while their API endpoints return `409` with an explicit local-mode message. Cloud deployments remain unchanged: they can use cookie sessions, PostgreSQL, and the normal login/register flows.

## Data and credits

Local data remains on the device under Electron’s `userData` directory. Local credits are workspace-local execution units for the current standalone product and must not be interpreted as a server-side billing ledger. A future Cloud Mode can provide centrally authoritative credits, organizations, billing, and device linking without changing the local runtime contract.

## Native dependency contract

The Next standalone build is created under the host Node ABI, but Electron embeds a different Node ABI. `scripts/prepare-desktop.mjs` therefore runs `electron-rebuild` for `better-sqlite3` and replaces the traced standalone copy before packaging. Without this step, the application can start but database requests fail with `ERR_DLOPEN_FAILED`.

## Release gate

Every desktop release must pass:

- `npm run typecheck`
- `npm test -- --run`
- `npm run build`
- `npm run desktop:smoke`
- Windows CI installer build with `--publish never`

The smoke test launches the standalone server through Electron, verifies the root-to-Workbench redirect, resolves the implicit local owner, confirms local registration is disabled, and checks the native runtime broker health endpoint.
