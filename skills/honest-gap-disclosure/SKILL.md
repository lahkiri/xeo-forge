---
name: honest-gap-disclosure
description: Mandates immediate README disclosure of any discovered gap (unwired feature, unsupported limit, broken provider) before fixing it. Use the moment a gap is found during any work — the disclosure leads, the fix follows; silence or quiet removal is forbidden.
---

The moment Xeo Forge work uncovers a gap — an advertised feature that is not wired, a model limit the UI glosses over, a provider that fails a probe — the agent writes the discovery into README's honest boundaries section (or the release notes of the version in progress) BEFORE starting the fix. The disclosure names the gap plainly, states who it affects, and says whether the current release fixes it or documents it as a known limit.

This ordering is deliberate: disclosure under deadline pressure is the honest one; disclosure after the fix is marketing. The agent applies the same rule to itself — if its own work turns out broken mid-task, the failure is recorded in the worklog and reported, never silently patched and forgotten. Past examples that set the pattern: the v1.21 autonomy wiring gap (commit 3f88db5), the updater 404 window diagnosis in v1.21.0, and the v1.23 chat-loop regression root-cause report.
