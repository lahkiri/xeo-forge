# Subagent Write Concurrency — Design Draft

**Status: DRAFT — awaiting the owner's explicit approval. No executable code may land from this document until that approval is recorded.** This is the design the README "Known gaps #5" and the Settings → Subagents page both point to: write-capable parallel delegation is documented before any code exists.

Author: agent (v1.25 workstream) · Date: 2026-08-29 · Governing law: v1.24 methodology (verify → fix → prove) + the standing rule that governance changes extend the existing zone-based, fail-closed stack — never around it.

---

## 1. Problem statement

`delegate_research` (v1.23) fans out up to 4 parallel subagents, but their toolset is physically limited to `file_read` / `file_list` / `web_search`, which makes concurrent writes impossible **by construction**. That is safe and sterile: real build work (the kind build-mode subagents would help with) needs at most a small number of writers, and unsynchronized writers race. Three concrete races exist in the current `FileTool` primitives the moment a second writer is introduced:

1. **Lost update (read-modify-write).** `file_edit` does `read → indexOf(oldString) → write`. Between two agents' read and write, the file can change; the second writer silently overwrites the first's edit (its anchor may still be present and unique — the uniqueness check does not see the collision).
2. **Blind overwrite.** `file_write` replaces a whole file unconditionally. A stale subagent can erase a sibling's newer content entirely.
3. **Unattributable interleaving.** Today the audit trail tags subagent steps with `sub-N`, but file mutations themselves are not recorded as first-class events — an auditor could not reconstruct which agent left which file state.

## 2. Scope and non-goals

**In scope:** parallel delegation that may call `file_write` / `file_edit`; conflict detection and refusal; write attribution in the audit trail; livelock prevention; the Settings surface required by AGENTS.md §17.

**Non-goals (explicit):**
- No operational/merging transforms, no three-way merge, no CRDT, no "last-writer-wins". The infrastructure refuses conflicts; the *agent* resolves them by re-reading and adapting — the same recovery it already performs after any failed tool call.
- No cross-process or multi-machine coordination. One run = one Node process = one ledger. Documented boundary, enforced by construction.
- No new permission semantics. No new autonomy level, no new rule file, no second policy engine. Writes by subagents are evaluated by the **same** `authorizeToolCall` chokepoint with the **same** per-level rule set the parent carries.
- No write capability for the `git_op` mutation set; git remains parent-only (`git_mutation` rules already gate it, and subagents never receive git tools).

## 3. Current state this design extends (verified in code)

| Primitive | File | Behavior today |
| --- | --- | --- |
| Delegation | `lib/agent/subagents.ts` | ≤4 subagents, ≤3 iterations each, read-only toolset set (`SUBAGENT_TOOL_NAMES`), parent's `ToolContext` passed verbatim, per-subagent `sub-N` tags on `tool_call`/`tool_result` events |
| Authority | `lib/agent/authority.ts` | Single chokepoint: `classifyToolCall` maps `file_write`/`file_edit` → `edit` action; per-level rules decide allow/deny; `ask` fails closed |
| Files | `lib/agent/files.ts` | `resolveWithin` realpath confinement; `write` (blind replace); `edit` (anchor-based, uniqueness-checked); no versioning, no locking |
| Audit | `lib/agent/events.ts` + SSE emitter | `tool_call`/`tool_result` events carry an optional `subagent` field; no file-mutation event exists |

## 4. Design

### 4.1 Mechanism 1 — the WriteLedger (per-task, in-process)

A `WriteLedger` instance is created per running task and handed to the tool context (exactly how `permissionRules` reached the gate in v1.21). It holds two maps:

- **Generation counter per file** (`relPath → integer`). Every successful `file_write`/`file_edit` through `FileTool` increments the file's generation.
- **Lease registry** (`relPath → agentId`). A lease is acquired for the duration of **one tool call only** (acquire → operate → release in `finally`), never per session — a crashed call cannot hold a lease, and there is nothing to deadlock over.

Every `file_read` result records the observed generation as a **read-stamp** for the calling agent (`agentId → path → gen`). Read-stamps are the basis of stale-write detection; they cost nothing and are kept in memory for the life of the run.

Single-writer invariant under the ledger: with only the parent writing (today's world), no lease is ever contended and no generation check ever fails — the mechanism is provably a no-op on existing behavior. This is what makes the two-commit rollout (§6) safe.

### 4.2 Mechanism 2 — conflict policy: refuse, never merge

A write call passes three ordered checks at the **existing** dispatch chokepoint (autonomy verdict unchanged, then two ledger checks inside the `FileTool` boundary):

1. **Autonomy** — unchanged `authorizeToolCall` verdict for `edit`. `ask` still fails closed; `deny` still cites the rule.
2. **Lease** — if the path is leased by another agent, refuse: `Write conflict on "src/a.ts": held by sub-2 right now. Re-read after it finishes.`
3. **Staleness** — if the caller's read-stamp for the path ≠ current generation, refuse: `Write conflict on "src/a.ts": the file changed (gen 3 → 5, last writer sub-2) after your read. Re-read and re-apply.`

`file_edit` keeps its anchor-uniqueness check as the second line of defense (it catches content-level collisions the generation counter can miss when both writers read at the same generation). There is deliberately **no queueing, no retry loop, no merge**: the refusal observation flows back to the calling agent as an ordinary failed tool observation, and the agent — parent or sub — decides to re-read and adapt. The infrastructure stays fail-closed; the intelligence does the resolving.

**Livelock lockout.** A subagent refused twice for writes to the same path is locked out of that path for the remainder of the delegation call (its further writes there fail closed with the citation). The parent is exempt — the parent always outranks its subs. This bounds ping-pong between two stubborn writers.

**Partitioning discipline (advisory).** The delegation prompt guidance gains one line: subagent prompts SHOULD name disjoint paths. The ledger never assumes the partition held — it is the backstop for when it does not.

### 4.3 Mechanism 3 — capability without a new policy path

Write-capable delegation is **not** a new grant; it is the existing gate evaluated per call:

- `SUBAGENT_TOOL_NAMES` gains `file_write`/`file_edit` **only when the parent task's rule set allows `edit`** (i.e., at autonomy levels whose rules permit parent writes). At `read_only`/`assist`, the identical `authorizeToolCall` refusal the parent would receive is what the subagent receives — capability emerges from the same rules, never from a parallel grant.
- The per-level `subagent` rules continue to gate `delegate_research` itself, unchanged.
- **Bounded blast radius:** write-capable delegation caps parallel writers at **2** per call (read-only delegation keeps its ≤4). Fixed constant, documented; a Settings knob may follow later under the §17 rule.
- Subagents still get no `code_execute`, no `git_op`, no MCP — the write surface is exactly `file_write`/`file_edit`, both workspace-confined by `resolveWithin` unchanged.

### 4.4 Mechanism 4 — attribution: every mutation is an event

A new audit event, emitted **only** from the `FileTool` write boundary (the same chokepoint that already sees every write), so parent and subagent mutations are mechanically identical and distinguishable only by attribution:

```
file_mutation {
  taskId, ts,
  agent: "parent" | "sub-1" | "sub-2" | ...,
  op: "write" | "edit",
  path: "src/a.ts",
  generationBefore, generationAfter,
  bytesBefore, bytesAfter,
  shaBefore, shaAfter,          // first 16 hex of sha256 — cheap replay anchor
  outcome: "applied" | "refused-lease" | "refused-stale" | "refused-policy",
  conflictWith?: "sub-2",       // present on refused-* outcomes
  ruleIndex?: number            // present on refused-policy, copied from the verdict
}
```

Consequences:
- **Replayability:** generation + hash pairs let an auditor reconstruct the exact per-file timeline and which agent produced each state — sub-N attribution extended to writes, closing the gap named in README #5.
- **Refusals are first-class events**, not silent errors: a conflict shows in the run timeline with who blocked whom, the same honesty standard as `decided_late`.
- The existing `tool_call`/`tool_result` `sub-N` tagging stays exactly as it is; `file_mutation` is the file-level complement, not a replacement.

## 5. What remains impossible by design

- Two writers ever interleave inside one tool call (lease).
- A stale writer ever lands (generation check + anchor uniqueness).
- A conflict ever resolving silently (no merge path exists in the design at all).
- A subagent writing outside the workspace or above its parent's authority (unchanged boundaries).
- Any second governance path (every check lives on the existing chokepoint).

## 6. Rollout — two provable commits (v1.24 law: verify → fix → prove)

1. **Commit A — ledger under single writer.** WriteLedger + generation counters + `file_mutation` events land with **zero** capability change: only the parent writes, so no conflict can occur. Tests pin: every parent write emits `file_mutation` with `agent: "parent"`; repeated writes increment generations; refusal paths are unit-exercised directly against the ledger. Live proof: a desktop run showing `file_mutation` events in the timeline exactly as before, plus the new events.
2. **Commit B — capability.** Conditional write toolset for subagents (§4.3) + lockout + cap of 2. Behavior tests, RED before B and GREEN after:
   - two subs, same file, same generation → exactly one applies; the other is refused-stale with `conflictWith` attribution;
   - two subs, disjoint files → both apply, no refusals;
   - parent write during a sub-run → the sub's subsequent edit is refused-stale;
   - `read_only` level → subagent `file_write` refused by the same rule citation the parent would get;
   - third conflict on one path → lockout refusal for that sub, parent unaffected;
   - attribution: every `file_mutation` carries agent + generations + hashes.
   Live proof: a desktop run with a deliberately colliding two-sub delegation showing one applied write and one attributed refusal in the timeline.

## 7. Settings surface (AGENTS.md §17 rule)

The Settings → Subagents page — which already promises "this page will carry that design's controls when it exists" — gains, only in Commit B: the write-delegation status (allowed/blocked by the task's level), the ≤2 writer cap, and the lockout disclosure. Read-only delegation keeps its existing panel untouched.

## 8. Open questions for the owner (decision points before any code)

1. **Lockout threshold of 2 refusals per sub per path** — acceptable, or 1 (stricter)?
2. **Writer cap of 2** — acceptable as a fixed constant for v1.25?
3. **Refusal semantics for the parent**: today a refused parent write reads like any failed tool call. Keep that (parent self-recovers), or add a dedicated parent-facing banner in the timeline?
4. **Should `file_mutation` be retrofitted to also fire for failed writes (policy refusals) in Commit A**, or only applied mutations plus ledger refusals as designed?

Nothing here executes without the owner's explicit approval of this document.
