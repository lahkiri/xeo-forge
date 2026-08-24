# Competitive Analysis: OpenHands (Agent Canvas) — 2026-08-23

## What they are now (they pivoted)

OpenHands (84.8k stars) rebranded their core product as **Agent Canvas**: a
self-hosted *developer control center for coding agents and automations*. They
orchestrate OpenHands, Claude Code, Codex, Gemini, or any ACP-compatible agent
across local, Docker, VM, and cloud backends. The agent loop itself now lives
in a separate Python repo (`software-agent-sdk`); this repo is the frontend.

Their trajectory matters more than their snapshot: they moved from "one
autonomous agent" to "run MANY agents anywhere". That is the opposite
direction from us — and it defines the fight.

## Their structural strengths (respect them)

- **Community gravity**: 84.8k stars, 11k forks, Slack, docs site, npm package.
- **Multi-agent orchestration**: any ACP agent, one canvas.
- **Automations**: scheduled workflows + webhooks + Slack/GitHub/Linear/Notion.
- **Backend flexibility**: local / Docker / VM / cloud from one UI.
- **Eval credibility**: years of SWE-bench-verified iteration in the SDK line.

## Their structural weaknesses (attack surface)

1. **Governance is shallow by design.** Their "control" is *where agents run*
   and *starting/stopping them*. No approval gate between planning and
   mutation, no authority rail, no reviewable memory, no audit-grade event
   trail as a product surface. You press Go and trust.
2. **Their quickstart ships our pitch.** The README's own warning:
   *"This runs the agent-server directly on the machine you're installing on —
   the agent will have full access to your filesystem!"* Xeo Forge is the
   direct answer to that sentence — and unlike them, we never had to bolt
   governance on afterwards.
3. **Complexity floor.** Multi-repo (frontend + Python agent-server + typed
   client + extensions package), Docker recommended, cloud pushed as "the most
   powerful way". Our floor: one installer, one process, one SQLite file.
4. **Local-first in name, cloud-first in story.** Their power narrative is a
   cloud server that keeps running when your laptop shuts. Ours is the laptop.
5. **No terminal, live git rail, diff-first review, or memory review** as
   first-class product surfaces in their frontend.

## The position we win

> They optimize for **running many agents**. We optimize for **trusting one**.

OpenHands is the answer to "how do I run five agents?" Xeo Forge is the answer
to "how do I let ONE agent touch my real project while staying in charge?"
Nobody else owns that sentence. Claude Code and Codex are execution surfaces;
Manus is general-purpose autonomy; OpenHands is orchestration breadth. The
governed-depth quadrant is open — v1.11-v1.13 already built most of it.

## What this means concretely (build order)

1. **Loop quality for strong models** (v1.13.x): done — profiles,
   observation-aware fingerprints, language-affinity gate.
2. **Parallel read-only tools** (v1.14): every serious agent has this; the
   multi-file read is the #1 wall-clock win and it is governance-neutral.
3. **Sandbox posture**: their Docker-everywhere answer is heavy; ours is
   honest restricted-host today, optional per-task container tomorrow. Do NOT
   chase them into "Docker required" — our floor must stay one exe.
4. **Do not chase**: multi-agent orchestration, automations webhooks,
   cloud backends. That is their road; it forfeits the governed-depth
   position. Revisit only with a written V3 design (AGENTS.md rule 8).
5. **Say the quiet part loudly**: every UI surface and doc should carry the
   contrast — approval gate, authority rail, audit trail, memory review,
   restricted execution. They cannot copy this without redesigning their
   product philosophy.
