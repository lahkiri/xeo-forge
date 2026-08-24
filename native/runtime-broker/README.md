# Xeo Forge Runtime Broker

`runtime-broker` is the first native performance boundary in Xeo Forge. It is a small, standard-library-only Go service intended for local runtime supervision: preview workers, repository helpers, and future desktop-managed processes.

The broker deliberately does **not** contain agent reasoning, prompt compilation, permissions, or approval policy. Those remain in the TypeScript/Next.js control plane where product behavior is easier to evolve and test. Go is used here for a narrow concern where a compiled, low-overhead, cross-platform supervisor is useful.

## Security model

`POST /v1/processes` starts an arbitrary local executable. That is remote code execution for anything that can reach the port, so the broker fails closed on two axes:

1. **Loopback-only bind.** The default address is `127.0.0.1:4317`. A non-loopback address (including the wildcard `:4317`) is refused at startup unless `XEO_RUNTIME_ALLOW_PUBLIC=1` is set explicitly.
2. **Shared-secret auth.** Every process-control request must present `XEO_RUNTIME_TOKEN` as `Authorization: Bearer <token>` or `X-Xeo-Runtime-Token`. Comparison is constant-time. When no token is configured, process control returns `503` and the broker serves only `/healthz` — it never runs unauthenticated.

The desktop shell mints a 32-byte random token per install, stores it `0600` under the Electron `userData` directory, and passes it to both the broker and the Next.js server through the environment. It is never exposed to a renderer.

## Run locally

```bash
# Health checks only — process control is disabled without a token.
go run .

# Full local supervision.
XEO_RUNTIME_TOKEN="$(openssl rand -hex 32)" go run .

# Choose another loopback port.
XEO_RUNTIME_ADDR=127.0.0.1:4400 XEO_RUNTIME_TOKEN=... go run .
```

## Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `XEO_RUNTIME_ADDR` | `127.0.0.1:4317` | Listen address. Must be loopback unless explicitly overridden. |
| `XEO_RUNTIME_TOKEN` | _(unset)_ | Shared secret for process control. Unset disables `/v1/processes`. |
| `XEO_RUNTIME_ALLOW_PUBLIC` | _(unset)_ | Set to `1` to permit a non-loopback bind. Understand the exposure first. |

## Endpoints

| Endpoint | Auth | Purpose |
| --- | --- | --- |
| `GET /healthz` | none | Version, capabilities, and whether process control is enabled |
| `GET /v1/processes` | token | List supervised local processes |
| `POST /v1/processes` | token | Start a process using an executable and argument array |
| `GET /v1/processes/:id` | token | Inspect one process |
| `POST /v1/processes/:id` | token | Stop one process |

The request body for starting a process is JSON:

```json
{
  "id": "preview-worker",
  "executable": "node",
  "args": ["scripts/preview-worker.mjs"],
  "workingDir": "C:/Users/me/xeo-forge",
  "env": { "NODE_ENV": "development" }
}
```

The broker accepts an argument array rather than a shell command string. That keeps process boundaries explicit and avoids adding shell parsing to the native layer.

## Test

```bash
go vet ./...
go test ./...
```

The suite covers the auth gate (missing, wrong, both header forms, and the no-token fail-closed path) and the bind guard (loopback detection, wildcard refusal, explicit opt-in).

## Build for Windows

```bash
GOOS=windows GOARCH=amd64 go build -trimpath -ldflags="-s -w" -o xeo-forge-runtime-broker.exe .
```

The desktop wrapper owns the broker lifecycle. The Next.js app currently uses only `/healthz`, through `app/api/runtime`; the process-control contract stays unused until the preview/worker path is measured in production-like runs.
