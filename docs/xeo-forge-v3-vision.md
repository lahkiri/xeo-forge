# Xeo Forge V3 — Product and Architecture Vision

## Product thesis

Xeo Forge is not another chat wrapper around a coding model. It is a governed execution environment for autonomous agents. The product should let a user delegate work, define the agent's operating rules without editing source code, review the proposed plan, observe execution, inspect artifacts, and retain useful project knowledge across tasks.

The positioning is:

> **Xeo Forge is the control plane for agentic work: persistent memory, explicit policies, inspectable execution, and verified artifacts.**

The product may cover both software-building and general knowledge-work, but it should preserve a clear center of gravity: every task is an execution job with a goal, context, tools, policy, budget, events, and deliverables.

## Core product principles

1. **Human control without micromanagement.** Planning, execution, review, and publication are distinct states. Approval gates are enforced by the runtime, not suggested by prompts.
2. **Memory with provenance.** The agent can learn preferences and project facts, but every memory has a scope, source, confidence, status, and deletion path. Learned content is data, never a privilege escalation.
3. **Instructions as product configuration.** System, workspace, role, skill, and task instructions are editable in the UI, versioned, prioritized, and included in the run context through a deterministic compiler.
4. **Artifacts over chat transcripts.** Every meaningful run should produce a structured result: files, preview URL, diff, report, test evidence, or a clear failure explanation.
5. **Policy-first tools.** Capabilities are granted by workspace and task policy. Cost, network, filesystem, and destructive actions are observable and bounded.
6. **Provider flexibility.** A model provider is an implementation detail. Xeo should work with OpenAI-compatible endpoints while allowing model routing later.
7. **Safe continuous improvement.** Learning is proposed after a run, deduplicated, confidence-scored, and surfaced to the user. The agent never silently changes high-impact policy.

## Product layers

| Layer | V3 responsibility | Initial implementation status |
| --- | --- | --- |
| Identity | Xeo persona, language affinity, transparent operating contract | Existing prompt; make configurable in later slice |
| Control plane | Tasks, approvals, policies, budgets, audit events, roles | Existing foundation; extend with instruction and memory scopes |
| Workspace | Persistent project context, files, default instructions, skills, connectors | Workspace model is the next major domain addition |
| Memory | Global preferences, workspace facts, task lessons, provenance, approval and recall | First V3 vertical slice |
| Prompt Studio | Editable system/workspace/task instructions, priority, versions, preview | First V3 vertical slice |
| Agent runtime | Planning, execution, verification, recovery, compaction, tool enforcement | Existing foundation; add compiled context and policy resolution |
| Artifacts | Files, previews, reports, diffs, test evidence, export | Existing preview/export foundation; add artifact index later |
| Automation | Scheduled and event-triggered jobs with limits and notifications | Post-foundation slice |
| Delegation | Specialist agents, parallel worktrees, review agents, merge gates | Post-foundation slice |
| Connectors | External services with scoped secrets and approval policies | Post-foundation slice |

## Persistent learning model

Memory is intentionally separated into three scopes:

- **Global profile:** user preferences such as language, formatting, coding conventions, and communication style.
- **Workspace memory:** durable facts about a project, architecture decisions, accepted commands, domain vocabulary, and known constraints.
- **Task memory:** short-lived notes and lessons belonging to one task or conversation.

Each memory record must contain `scope`, `content`, `kind`, `status`, `confidence`, `source_task_id`, `source_message_id`, timestamps, and optional expiry. The runtime loads only active memories within the task's scope. New memories are created as `proposed` unless explicitly pinned by the user. The settings UI must support approve, pin, edit, archive, and delete actions.

The first implementation uses lexical deduplication and an explicit memory budget. A future semantic index can be added behind the same query API without changing the agent loop.

## Prompt Studio model

Instructions are saved as versioned records with `scope` (`system`, `global`, `workspace`, `role`, `skill`, or `task`), a name, content, enabled flag, priority, and optional task/workspace relationship. The prompt compiler orders them deterministically:

1. immutable safety and trust boundary;
2. Xeo identity and runtime contract;
3. global active instructions;
4. workspace instructions;
5. role and skill instructions;
6. active approved memories;
7. task instructions;
8. user goal and uploaded-data manifest.

User-editable instructions can shape behavior, but cannot override platform safety policy, tool permissions, approval gates, or the trust boundary for uploaded content.

## V3 execution roadmap

### Slice A — Memory and Prompt Studio

Add persistent memory and instruction tables, query helpers, settings endpoints, a context compiler, and a dashboard settings surface. The initial slice will make the current task runner consume compiled instructions and active memories while keeping the existing planning/build gate intact.

### Slice B — Workspaces and skills

Add workspaces, workspace membership, persistent project roots, reusable skills with input fields, and task creation from a skill template. A workspace becomes the durable home for files, instructions, memories, and connectors.

### Slice C — Agent modes and verification

Add explicit modes for Plan, Build, Review, Research, and Operate. Each mode receives a different tool policy and completion contract. Verification becomes a first-class artifact with tests, preview checks, and human review status.

### Slice D — Delegation and model routing

Add specialist roles such as planner, implementer, researcher, tester, and reviewer. Delegation is bounded by a task budget, a maximum depth, and a merge/review gate. Model routing can choose a fast, deep, or local provider by role.

### Slice E — Automation and connectors

Add schedules, event triggers, connector permissions, scoped secrets, and notification preferences. Background runs must be idempotent, observable, cancellable, and subject to the same policy and budget system as interactive runs.

## Non-goals for the first V3 slice

The first slice will not attempt to implement a marketplace, arbitrary plugins, unrestricted remote browser automation, multi-agent worktrees, semantic vector search, or a fully general office automation suite. These require separate security and product decisions and should not dilute the core control-plane foundation.


## Implementation status — Slice A

Slice A is now implemented on the `feat/v3` branch. It includes the `agent_instructions` and `agent_memories` tables, deterministic context compilation, task/global Prompt Studio APIs, the `/settings` control surface, and a task-level context tab. Verified task runs can propose up to eight bounded memories through `task_complete`; proposals are deduplicated, marked `proposed`, and remain unloaded until the user activates them. Planning runs never create persistent memories. The existing Plan → Approve → Build gate, tool locks, task audit events, and preview flow remain in place.

The next product boundary is Slice B: durable workspaces and reusable skills. That slice should move global/task context into a workspace hierarchy, add membership and role-based policy resolution, and let users start a task from a skill template. It should be implemented only after deciding the workspace ownership model and whether a workspace may contain multiple projects or one project root.


## Implementation status — Slice A/B foundation

The `feat/v3` branch now also includes reusable Agent Profiles. A profile is a user-owned, versioned operating role (`builder`, `researcher`, `analyst`, `operator`, or `custom`) with editable instructions and description. Users can create, enable, disable, and delete profiles in Profile Studio, select an enabled profile when creating a task, and the runtime compiles the selected profile into the task context below immutable policy and tool permissions. Existing tasks remain compatible with a null profile.

This is intentionally a guidance layer, not a permission layer. Profiles cannot bypass the Plan → Approve → Build transition, alter sandbox boundaries, reveal secrets, or authorize dangerous actions. The next major implementation boundary remains durable workspaces and reusable skills, where profiles can become workspace-scoped roles instead of only user-scoped presets.
