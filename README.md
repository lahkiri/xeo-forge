# Xeo Forge

<p align="center">
  <img src="logo.png" width="120" alt="Xeo Forge Logo">
</p>

<h3 align="center">Autonomous AI Agent Platform</h3>

<p align="center">
  <em>Plan. Approve. Build. Ship. One agent, two modes, zero babysitting.</em>
</p>

<p align="center">
  <a href="https://github.com/lahkiri/xeo-forge/blob/master/LICENSE">
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
    <img src="https://img.shields.io/badge/Tests-8%20files-brightgreen.svg" alt="Tests">
  </a>
</p>

---

## What is Xeo Forge?

Xeo Forge is an autonomous AI agent platform that executes tasks through a two-phase workflow:

1. **Planning Mode** - The agent analyzes your request and produces a structured plan. No files are modified.
2. **Build Mode** - After you approve the plan, the agent executes it with full tool access.

This separation ensures you maintain control over what gets built.

---

## Key Features

### Dual-Mode Execution
- **Planning** - Read-only analysis. Agent inspects your project and proposes changes.
- **Building** - Full execution. Agent implements the approved plan.
- **Approval Gate** - You review and approve before any writes happen.

### Real-Time Streaming
- Server-Sent Events (SSE) for live task progress.
- Events are persisted to database, not kept in memory.
- Reload the page and see the same history.

### Credit System
- Atomic credit deductions per task.
- Ledger with full audit trail.
- Daily credit grants per user.
- Admin can adjust credits.

### Runtime Safety
- Stagnation detection stops loops.
- Read-only loop detection prevents endless file reading.
- Text termination guards catch incomplete responses.
- Per-task sandboxed workspaces.

### Context Management
- Automatic compaction when context gets large.
- Older messages archived, summary preserved.
- System prompt and plan never modified.

### Security
- SSRF protection on HTTP requests.
- Zod validation on all inputs.
- Session-based authentication.
- Path confinement for file operations.

---

## Project Structure

```
xeo-forge/
|-- app/                    # Next.js 14 App Router
|   |-- api/                # REST API endpoints
|   |   |-- auth/           # Login, logout, register, me
|   |   |-- tasks/          # Task CRUD + operations
|   |   |-- credits/        # Balance and ledger
|   |   +-- admin/          # User and model management
|   |-- dashboard/          # Task creation UI
|   |-- tasks/[id]/         # Task execution view
|   |-- admin/              # Admin panel
|   +-- login/              # Authentication
|
|-- lib/                    # Core logic
|   |-- agent/              # Agent engine
|   |   |-- loop.ts         # Main execution loop
|   |   |-- runner.ts       # Task runner
|   |   |-- tools.ts        # Tool definitions
|   |   |-- files.ts        # File operations
|   |   |-- code.ts         # Code execution
|   |   |-- prompts.ts      # System prompts
|   |   |-- context.ts      # Context management
|   |   +-- compaction.ts   # Auto-compaction
|   |-- db/                 # Database layer
|   |   |-- index.ts        # SQLite/PostgreSQL adapter
|   |   |-- schema.ts       # Schema definitions
|   |   +-- queries.ts      # Database queries
|   |-- auth/               # Authentication
|   |-- credits/            # Credit engine
|   |-- model/              # Model configuration
|   +-- sse/                # Event streaming
|
|-- test/                   # Unit tests (8 files)
+-- scripts/                # Database initialization
```

---

## Quick Start

```bash
# Clone the repository
git clone https://github.com/lahkiri/xeo-forge.git
cd xeo-forge

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

Open http://localhost:3000 and create an account.

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | No | - | PostgreSQL connection string (uses SQLite if not set) |
| `ROOT_ADMIN_EMAIL` | Yes | - | Root admin email (created on init) |
| `ROOT_ADMIN_PASSWORD` | Yes | - | Root admin password |
| `MODEL_NAME` | Yes | - | Display name for AI model |
| `MODEL_BASE_URL` | Yes | - | OpenAI-compatible API endpoint |
| `MODEL_API_KEY` | Yes | - | API key |
| `MODEL_ID` | No | `gpt-4o-mini` | Model identifier |
| `MODEL_TEMPERATURE` | No | `0.7` | Sampling temperature |
| `MODEL_MAX_TOKENS` | No | `4000` | Max tokens per response |
| `DEFAULT_DAILY_GRANT` | No | `50` | Daily credits per user |

---

## API Endpoints

### Authentication
| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/auth/register` | Create account |
| `POST` | `/api/auth/login` | Sign in |
| `POST` | `/api/auth/logout` | Sign out |
| `GET` | `/api/auth/me` | Get current user |

### Tasks
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/tasks` | List tasks |
| `POST` | `/api/tasks` | Create task |
| `GET` | `/api/tasks/:id` | Get task |
| `GET` | `/api/tasks/:id/stream` | SSE event stream |
| `POST` | `/api/tasks/:id/approve` | Approve plan |
| `POST` | `/api/tasks/:id/reject` | Reject plan |
| `POST` | `/api/tasks/:id/mode` | Switch mode |
| `GET` | `/api/tasks/:id/messages` | Get messages |
| `POST` | `/api/tasks/:id/uploads` | Upload files |
| `GET` | `/api/tasks/:id/preview` | Preview info |
| `GET` | `/api/tasks/:id/workspace` | List workspace |
| `POST` | `/api/tasks/:id/export` | Export data |

### Credits
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/credits` | Get balance and history |

### Admin
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/admin/users` | List users |
| `PATCH` | `/api/admin/users/:id` | Update user |
| `POST` | `/api/admin/users/:id/credits` | Adjust credits |
| `GET/PUT` | `/api/admin/model` | Model config |

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | Next.js 14 (App Router) |
| UI | React 18 + Tailwind CSS |
| Language | TypeScript 5 (strict) |
| Database | SQLite (dev) / PostgreSQL (prod) |
| AI | OpenAI SDK |
| Auth | Cookie sessions |
| Testing | Vitest |
| Validation | Zod |

---

## Commands

```bash
npm run dev          # Start development server
npm run build        # Build for production
npm start            # Start production server
npm test             # Run tests
npm run typecheck    # Type checking
npm run db:init      # Initialize database
```

---

## License

MIT License. See [LICENSE](LICENSE) for details.
