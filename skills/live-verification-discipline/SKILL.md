---
name: live-verification-discipline
description: Governs how Xeo Forge features are declared complete. Use when finishing any fix or feature — no claim of "done" is valid without a live probe (real API response, DB row content, or captured behavior) attached as evidence. Text descriptions of intent are never evidence.
---

Xeo Forge treats an unverified claim of completion as a regression risk, not a milestone. When the agent believes a fix or feature is done, it first produces a live probe against the actual running system: a real provider API response for model claims, a raw DB row for persistence claims, a captured stream or request trace for UI claims. The probe result is attached to the work summary verbatim, including failures and partial results.

If a probe cannot run in the current environment (missing native modules, no network, offline provider), the agent states exactly which verification was skipped and marks the affected claims as "documented only, not live-verified" — the distinction travels with the claim wherever it is reported. A feature that cannot demonstrate its wiring across every layer it touches is reported as not finished, regardless of how complete the code looks.
