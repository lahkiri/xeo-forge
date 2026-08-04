# Xeo Forge

<p align="center">
  <img src="logo.png" width="120" alt="Xeo Forge Logo">
</p>

<h3 align="center">Autonomous AI Agent Platform with Dual Execution Modes</h3>

<p align="center">
  <em>Plan -> Approve -> Build -> Ship. One agent, two modes, zero babysitting.</em>
</p>

<p align="center">
  <a href="https://github.com/lahkiri/xeo-forge2/blob/master/LICENSE">
    <img src="https://img.shields.io/badge/license-MIT-green.svg" alt="License">
  </a>
  <a href="#">
    <img src="https://img.shields.io/badge/version-1.0.0-blue.svg" alt="Version">
  </a>
  <a href="#">
    <img src="https://img.shields.io/badge/TypeScript-5.5-blue.svg?logo=typescript" alt="TypeScript">
  </a>
  <a href="#">
    <img src="https://img.shields.io/badge/Next.js-14-black.svg?logo=nextdotjs" alt="Next.js">
  </a>
  <a href="#">
    <img src="https://img.shields.io/badge/React-18-blue.svg?logo=react" alt="React">
  </a>
  <a href="#">
    <img src="https://img.shields.io/badge/Tailwind-3.7-blue.svg?logo=tailwindcss" alt="Tailwind">
  </a>
  <a href="#">
    <img src="https://img.shields.io/badge/Tests-119%20passing-brightgreen.svg" alt="Tests">
  </a>
</p>

<p align="center">
  <a href="#features">Features</a> |
  <a href="#architecture">Architecture</a> |
  <a href="#quick-start">Quick Start</a> |
  <a href="#api">API</a> |
  <a href="#tech-stack">Tech Stack</a>
</p>

---

## Features

### Dual-Mode Agent Execution
- **Planning Mode** - Read-only inspection. The agent analyzes your project and produces a structured plan. Write tools are hard-locked at the dispatch layer.
- **Build Mode** - Full tool access. Executes the user-approved plan as an immutable contract. No plan rewriting during execution.

### Real-Time Streaming
- SSE (Server-Sent Events) with a single delivery path - events are persisted first, then forwarded to live listeners.
- No in-memory replay buffers. No duplicate events. What you see on reload is exactly what streamed live.

### Atomic Credit System
- Every balance change writes a `credit_ledger` row with `balance_after`.
- Debits are atomic: `UPDATE ... WHERE balance >= ?` - no read-then-write races.
- Admin can adjust credits, view ledger history, and manage users.

### Runtime Safety Guards
- **Stagnation detection** - Detects repeated tool calls and escalates before terminating.
- **Read-only loop detection** - Prevents the agent from reading files endlessly without acting.
- **Text termination guards** - In build mode, catches fake completions (questions to user, descriptions without action).
- **Execution evidence** - Tracks actual tool calls, file modifications, and code executions for truth-based verification.

### Context Management
- Automatic compaction when context usage exceeds the admin-configurable threshold.
- Older messages are archived and replaced with a system summary.
- System prompt and approved plan are never touched by compaction.

### Universal Language Support
- Detects user language (Arabic, Chinese, French, etc.) and responds accordingly.
- Code and technical identifiers stay in English.

### Security
- SSRF protection on HTTP requests (blocks private IPs, loopback, cloud metadata).
- Zod validation on all tool arguments.
- Per-task sandboxed workspaces with path confinement.
- Session-based auth with hashed tokens.

---

## Architecture

```
xeo-forge/
|-- app/                    # Next.js 14 App Router
|   |-- api/                # REST endpoints (22+ routes)
|   |   |-- auth/           # Login, logout, register, me
|   |   |-- tasks/          # CRUD + approve/reject/mode/stream
|   |   |-- credits/        # Balance + ledger
|   |   +-- admin/          # Users, model config, audit
|   |-- dashboard/          # Task creation & management
|   |-- tasks/[id]/         # Task execution (SSE + workspace)
|   |-- admin/              # Admin panel
|   |-- login/              # Authentication
|   +-- register/           # User registration
|
|-- lib/                    # Core logic
|   |-- agent/              # Agent engine
|   |   |-- loop.ts         # Main execution loop with guards
|   |   |-- runner.ts       # Fire-and-forget task runner
|   |   |-- tools.ts        # Tool definitions + dispatch
|   |   |-- files.ts        # File read/write/edit/list
|   |   |-- code.ts         # Bash/Python execution
|   |   |-- preview.ts      # Live preview server
|   |   |-- prompts.ts      # System prompts
|   |   |-- context.ts      # Context window accounting
|   |   +-- compaction.ts   # Auto-compaction
|   |-- db/                 # Database layer
|   |   |-- index.ts        # SQLite/PostgreSQL adapter
|   |   |-- schema.ts       # DDL + migrations
|   |   +-- queries.ts      # All read/write operations
|   |-- auth/               # Authentication
|   |-- credits/            # Credit engine
|   |-- model/              # Global model config
|   |-- sse/                # Event streaming
|   +-- types.ts            # Shared TypeScript types
|
|-- components/             # Shared UI components
|-- test/                   # Vitest unit tests (119 tests)
+-- scripts/                # Database init scripts
```

### Data Model

| Table | Purpose |
|-------|---------|
| `users` | User accounts with admin/suspended flags |
| `auth_sessions` | Cookie-based session tokens |
| `credits` | Per-user balance + daily grant |
| `credit_ledger` | Immutable audit trail of all credit changes |
| `tasks` | Task state, plan, approved plan, result |
| `task_events` | Monotonic seq-ordered event log |
| `messages` | Conversation history (active + archived) |
| `model_settings` | Single global model config (row id=1) |
| `admin_actions` | Admin audit trail |
| `uploads` | User-uploaded files with quarantine pipeline |

---

## Quick Start

```bash
# Clone the repository
git clone https://github.com/lahkiri/xeo-forge2.git
cd xeo-forge2

# Install dependencies
npm install

# Set up environment
cp .env.example .env
# Edit .env with your configuration

# Initialize the database
npm run db:init

# Start development server
npm run dev
```

Open http://localhost:3000 and start building.

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | Prod | - | PostgreSQL connection string |
| `ROOT_ADMIN_EMAIL` | Yes | - | Root admin email (seeded on init) |
| `ROOT_ADMIN_PASSWORD` | Yes | - | Root admin password (seeded on init) |
| `MODEL_NAME` | Yes | - | Display name for the AI model |
| `MODEL_BASE_URL` | Yes | - | OpenAI-compatible API endpoint |
| `MODEL_API_KEY` | Yes | - | API key for the model |
| `MODEL_ID` | Yes | `gpt-4o-mini` | Model identifier |
| `MODEL_TEMPERATURE` | - | `0.7` | Sampling temperature |
| `MODEL_MAX_TOKENS` | - | `4000` | Max tokens per response |
| `DEFAULT_DAILY_GRANT` | - | `50` | Daily credit grant per user |
| `TASK_WORK_DIR` | - | `/tmp/xeo-tasks` | Agent workspace root |

Without `DATABASE_URL`, the system uses SQLite at `data/xeo.db` - perfect for local development.

---

## API

### Authentication

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/auth/register` | Create account |
| `POST` | `/api/auth/login` | Sign in |
| `POST` | `/api/auth/logout` | Sign out |
| `GET` | `/api/auth/me` | Current user |

### Tasks

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/tasks` | List user's tasks |
| `POST` | `/api/tasks` | Create new task |
| `GET` | `/api/tasks/:id` | Get task details |
| `GET` | `/api/tasks/:id/stream` | SSE event stream |
| `POST` | `/api/tasks/:id/approve` | Approve plan -> build |
| `POST` | `/api/tasks/:id/reject` | Reject plan |
| `POST` | `/api/tasks/:id/mode` | Switch mode |
| `GET` | `/api/tasks/:id/messages` | Conversation history |
| `POST` | `/api/tasks/:id/uploads` | Upload files |
| `GET` | `/api/tasks/:id/preview` | Preview server info |
| `GET` | `/api/tasks/:id/workspace` | List workspace files |
| `GET` | `/api/tasks/:id/workspace/*` | Read workspace file |
| `POST` | `/api/tasks/:id/export` | Export task data |

### Credits

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/credits` | Get balance + ledger |

### Admin

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/admin/users` | List all users with stats |
| `PATCH` | `/api/admin/users/:id` | Update user (suspend/unsuspend) |
| `POST` | `/api/admin/users/:id/credits` | Adjust user credits |
| `GET/PUT` | `/api/admin/model` | View/update global model config |

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| **Framework** | Next.js 14 (App Router) |
| **UI** | React 18 + Tailwind CSS |
| **Language** | TypeScript 5 (strict) |
| **Database** | SQLite (dev) / PostgreSQL (prod) |
| **AI** | OpenAI SDK (streaming tool calls) |
| **Auth** | Cookie sessions with SHA-256 hashed tokens |
| **Testing** | Vitest |
| **Validation** | Zod |

---

## Testing

```bash
# Run all tests
npm test

# Watch mode
npm run test:watch

# Type checking
npm run typecheck
```

---

## Production Deployment

```bash
# Build
npm run build

# Start
npm start
```

Set `NODE_ENV=production` and configure `DATABASE_URL` for PostgreSQL.

---

## License

MIT License. See [LICENSE](LICENSE) for details.
