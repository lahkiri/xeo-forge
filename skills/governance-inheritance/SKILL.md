---
name: governance-inheritance
description: Requires every new agent capability (subagents, sandbox tiers, future computer-use) to execute through the existing zone/permission-rule stack. Use when adding any capability that acts on the system — a capability with its own permission path is a design defect.
---

New Xeo Forge capabilities never create their own permission path. When the agent adds a feature that acts on the workspace, network, or host — subagent delegation, sandbox tiers, browser control, anything future capabilities share — it routes that capability's decisions through the existing PermissionRule engine: classifyToolCall gains a case, the per-level AUTONOMY_RULES gain their rows as data, and dispatch runs through the same authorizeToolCall gate every other tool answers to.

If a new capability seems to need an exception from the rule engine, the agent stops and widens the rule vocabulary instead (a new action type or resource prefix, expressed as data with an audit note). The agent never hardcodes an if that decides permission by capability identity. Subagent children inherit the parent's rule set verbatim — a delegated actor holding broader authority than its parent is treated as a security defect, not a convenience.
