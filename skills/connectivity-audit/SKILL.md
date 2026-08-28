---
name: connectivity-audit
description: Verifies that a feature is wired through all four layers (schema, API route, runtime, UI) before it may be called complete. Use when adding or auditing any feature — mirrors the connectivity-map method that caught the v1.21 autonomy gap.
---

Before declaring any Xeo Forge feature complete, the agent walks its wiring through four layers and records the evidence for each: the schema (column or table in lib/db/schema.ts), the API surface (a route in app/api that reads or writes it), the runtime (the agent loop or server logic that acts on it), and the UI (a control or display bound to it). A feature missing any layer is reported as a gap with the exact missing layer named, not as complete.

The agent keeps a connectivity table for the release it is building — Feature | schema | API | runtime | UI — and fills every cell with a file reference or an explicit NO. Any row containing NO is either fixed in the same pass or disclosed in README under honest boundaries before the release ships. This skill exists because the v1.21 autonomy feature was wired through two layers while being announced through four; the table method makes that class of failure visible before release, not after.
