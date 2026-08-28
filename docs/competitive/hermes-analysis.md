# Competitive analysis: Hermes Agent (NousResearch)

*Verified against the actual repositories (shallow clones, Aug 2026): hermes-agent @ 6dcebea7, plus OpenHands' software-agent-sdk and automation services. File paths below are real paths, not paraphrase. Companion to `docs/competitive/openhands-analysis.md` and the summary table in README.*

## What Hermes actually does (verified, with sources)

| Capability | Evidence | Mechanism |
|---|---|---|
| Closed learning loop | `agent/skills/*` | Skills are SKILL.md files the agent WRITES for itself after complex experiences, then refines on later use — the skill corpus improves at runtime |
| Cross-session memory | `agent/memory/*` | SQLite FTS5 over externalized content + LLM summarization; an adaptive-detail search tool answers recall questions at zero LLM cost |
| Anywhere access | `gateway/*` | One gateway process fans a single conversation out to Telegram/Discord/Slack/WhatsApp/Signal/CLI simultaneously |
| Seven execution backends | `agent/backends/*` | local, Docker, SSH, Singularity, Modal, Daytona, Vercel Sandbox behind one backend interface; some serverless backends hibernate to near-zero cost |
| Parallel delegation | `agent/conversation_loop.py` + delegation tools | Fresh-context child agents (depth 1) for parallel work; results return as NEW TURNS (never spliced into old messages — protects role alternation and prompt caching); background mode persists durable completion records in SQLite |
| Python RPC kernels | tool kernels | Multi-step pipelines collapse into "one round" by calling tools from Python via RPC — no context tax per step |
| Scheduled automation | `agent/scheduler/*` | 60s tick + file lock; a natural-language cron that delivers to any connected platform |
| Tool dispatch | `agent/tools/registry.py` | Self-registering `ToolEntry(name, toolset, schema, handler, check_fn, emoji, max_result_size_chars)`; availability checks cached 30s with a 60s failure-grace so one flaky Docker probe can't silently strip a toolset; `dispatch()` catches everything into sanitized `{"error"}` results; parallel batches re-append results in original call order with a batch-level authorization gate |
| Loop safety | `agent/conversation_loop.py:1823` `run_conversation()` | Budget-bounded while-loop, one-call "grace" before exit, first-class exit-reason taxonomy (`interrupted_by_user / budget_exhausted / guardrail_halt / session_persistence_failed`), `/steer` injection into the last tool message before the API call, and persistence-before-side-effects (the tool-call turn is flushed to SQLite BEFORE tools run) |
| Open skill standard | repo root | agentskills.io-compatible SKILL.md with YAML frontmatter — the same standard our Skills screen imports |

## What Hermes does that we now do too (v1.23)

- **Parallel delegation** — `delegate_research` (lib/agent/subagents.ts): bounded, read-only, parent-authority-inherited, per-subagent audit attribution. Narrower than Hermes by design (no writes → no race conditions yet), but real and governed.
- **Honest tool results** — Hermes' sanitized `{"error"}` discipline matches our fail-closed rule-cited refusals; v1.23 additionally cites the rule index in audit hooks.
- **Sandbox tiers** — Hermes' backend abstraction (local→Docker) validates our standard/strict/docker ladder; ours is task-row data enforced through the same permission engine.
- **Skills as files** — the five v1.23 skills in `skills/*/SKILL.md` speak the same agentskills.io dialect Hermes uses.

## What Hermes still does that we do not (documented gaps, not hidden ones)

1. **Multi-platform presence** (Telegram/Discord/…). Our surface is the app. Tracked as roadmap, not v1.23.
2. **Self-improving skills** — Hermes rewrites its skills from experience; ours are curated. Evaluation for post-v1.23 (accuracy risk is real).
3. **Execution backend variety** (SSH/Modal/Daytona…). We ship local + Docker tiers.
4. **Write-capable delegation** — Hermes subagents can mutate; ours are read-only until the concurrent-write design is proven.

## Where Xeo Forge is deliberately ahead

- **Governance as data, visible at runtime**: Hermes gates tools with `check_fn`s — code. Our AUTONOMY_RULES are declarative rows (first-match, cited by index in the audit trail, rendered live in the authority panel). Neither Hermes nor OpenHands exposes rule-cited, fail-closed authority to the user in the product UI.
- **Thinking-effort honesty**: eight levels each classified native vs simulated per run, emitted as a `thinking_level` event, with an explicit warning when a level produced no streamable reasoning.
- **Chat/Work separation with different authority, same intelligence** — Hermes is one agent with one tool belt; our surfaces differ by capability contract, provably (the tool schema itself is the boundary, not a prompt request).

## Design language takeaways applied in v1.23

From Hermes' web dashboard + TUI tokens (verified in `web/src/index.css`, `ui-tui/src/theme.ts`): dark teal ground (`#041c1c`) with cream text (`#ffe6cb`), cards as 4% color-mix of text-over-ground, 15% mix borders, 15px/1.55 base type, 0.5rem radius scale, spacing driven by one `--spacing` multiplier, built-in RTL via logical properties, braille spinners distinct for thinking vs tool activity, and `▾/▸` collapsibles for reasoning. v1.23 adopts the *system* (single token sheet, mix-based cards, honest collapsible thinking with a distinct live state, logical-property RTL) rather than the palette — our forge identity stays ink/copper.
