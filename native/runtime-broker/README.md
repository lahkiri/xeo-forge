# Xeo Forge Runtime Broker

`runtime-broker` is the first native performance boundary in Xeo Forge. It is a small, standard-library-only Go service intended for local runtime supervision: preview workers, repository helpers, and future desktop-managed processes.

The broker deliberately does **not** contain agent reasoning, prompt compilation, permissions, or approval policy. Those remain in the TypeScript/Next.js control plane where product behavior is easier to evolve and test. Go is used here for a narrow concern where a compiled, low-overhead, cross-platform supervisor is useful.

## Run locally

```bash
go run .

# or choose another local-only address
a=XEO_RUNTIME_ADDR=127.0.0.1:4317
go run .
```

The service listens on the loopback interface by default when `XEO_RUNTIME_ADDR=127.0.0.1:4317` is set. The default `:4317` is convenient for development; the Windows shell should set the loopback address explicitly.

## Endpoints

| Endpoint | Purpose |
| --- | --- |
| `GET /healthz` | Version and capability check |
| `GET /v1/processes` | List supervised local processes |
| `POST /v1/processes` | Start a process using an executable and argument array |
| `GET /v1/processes/:id` | Inspect one process |
| `POST /v1/processes/:id` | Stop one process |

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

The broker is intentionally local-only and accepts an argument array rather than a shell command string. That keeps process boundaries explicit and avoids adding shell parsing to the native layer.

## Build for Windows

```bash
GOOS=windows GOARCH=amd64 go build -trimpath -ldflags="-s -w" -o xeo-forge-runtime-broker.exe .
```

The Windows desktop wrapper will own the broker lifecycle. The Next.js app should only use the broker through a narrow adapter once the preview/worker contract is measured in production-like runs.
