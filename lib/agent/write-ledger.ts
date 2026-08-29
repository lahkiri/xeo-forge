/**
 * WriteLedger — the per-task, in-memory write-coordination record
 * (Commit A of docs/subagent-write-concurrency-design.md, owner-approved).
 *
 * §4.1 mechanisms, verbatim in spirit:
 *  - ONE generation counter per file path. Every successful write/edit
 *    through the FileTool boundary increments it.
 *  - ONE lease per path, held for the duration of a SINGLE tool call
 *    (acquire → operate → release). Never per session: a crashed call cannot
 *    hold a lease, and there is nothing to deadlock over.
 *  - Read-stamps: every file_read records the generation the caller saw,
 *    per agent. Stamps are what staleness detection compares against; they
 *    cost nothing and live for the life of the run.
 *
 * §4.2 policy: refuse, never merge. No three-way merge, no last-writer-wins,
 * no CRDT, no queueing, no retry loop exists here. The caller gets a
 * structured refusal event and an ordinary failed-tool observation; the
 * AGENT resolves the conflict by re-reading. The infrastructure stays
 * fail-closed; the intelligence does the resolving.
 *
 * §4.4 attribution: this module RETURNS the event for every attempted
 * mutation — applied and ledger-refused alike (the owner's Q4 ruling keeps
 * policy refusals on the existing governance path). It never emits, never
 * touches I/O, and never decides policy: emission belongs to the FileTool
 * write boundary, authority stays in authorizeToolCall.
 *
 * Single-writer invariant (§4.1): with only the parent writing — today's
 * world, Commit A — no lease is ever contended and no generation check ever
 * fails. The mechanism is provably a no-op on existing behavior; second
 * writers arrive only in Commit B.
 */

/** Who acted. `"parent"` today; `sub-N` arrives with Commit B capability. */
export type LedgerAgent = string;

export type MutationOp = 'write' | 'edit';

export type MutationOutcome = 'applied' | 'refused-lease' | 'refused-stale';

/**
 * The file_mutation audit event (§4.4). `readStampAt` is additive beyond the
 * design schema: on a refused-stale outcome it records the generation the
 * caller THOUGHT was current, which is exactly what the refusal message
 * quotes ("gen 3 → 5") and what an auditor needs to reconstruct the stale
 * read. Absent on applied and refused-lease outcomes.
 */
export interface FileMutationEvent {
  agent: LedgerAgent;
  op: MutationOp;
  path: string;
  generationBefore: number;
  generationAfter: number;
  /** 0 when the file did not exist before the attempt. */
  bytesBefore: number;
  bytesAfter: number;
  /** sha256[:16] replay anchor; null when the file did not exist. */
  shaBefore: string | null;
  shaAfter: string | null;
  outcome: MutationOutcome;
  /** Present on refused-* outcomes: who caused the refusal. */
  conflictWith?: LedgerAgent;
  /** Present on refused-stale: the caller's lagging read-stamp. */
  readStampAt?: number;
}

/** What FileTool's perform() reports about the bytes it just landed. */
export interface MutationDigests {
  bytesBefore: number;
  bytesAfter: number;
  shaBefore: string | null;
  shaAfter: string | null;
}

/** The failed-tool observation a ledger refusal becomes (§4.2 wording). */
export function refusalMessage(event: FileMutationEvent): string {
  if (event.outcome === 'refused-lease') {
    return `Write conflict on "${event.path}": held by ${event.conflictWith} right now. Re-read after it finishes.`;
  }
  if (event.outcome === 'refused-stale') {
    return `Write conflict on "${event.path}": the file changed (gen ${event.readStampAt} → ${event.generationBefore}, last writer ${event.conflictWith}) after your read. Re-read and re-apply.`;
  }
  throw new Error(`refusalMessage: not a refusal outcome (${event.outcome})`);
}

/** Thrown by FileTool when the ledger refuses a mutation. */
export class WriteConflictError extends Error {
  readonly event: FileMutationEvent;

  constructor(message: string, event: FileMutationEvent) {
    super(message);
    this.name = 'WriteConflictError';
    this.event = event;
  }
}

export class WriteLedger {
  /** §4.1 map 1: relPath → generation. Starts at 0 (never written through the ledger). */
  private readonly generations = new Map<string, number>();
  /** §4.1 map 2: relPath → current lease holder (single tool call, released in finally). */
  private readonly leases = new Map<string, LedgerAgent>();
  /** agentId → (relPath → generation the agent last observed via file_read or its own write). */
  private readonly readStamps = new Map<LedgerAgent, Map<string, number>>();
  /** relPath → who last successfully wrote it (conflictWith attribution on stale refusals). */
  private readonly lastWriter = new Map<string, LedgerAgent>();

  /** Current generation for a path; 0 means never written through this ledger. */
  generation(relPath: string): number {
    return this.generations.get(relPath) ?? 0;
  }

  /** The agent currently holding the path's lease, if any. */
  leaseHolder(relPath: string): LedgerAgent | undefined {
    return this.leases.get(relPath);
  }

  /** The generation the agent last observed for the path (0 = never read). */
  readStamp(agent: LedgerAgent, relPath: string): number {
    return this.readStamps.get(agent)?.get(relPath) ?? 0;
  }

  /**
   * Record a read. Called by FileTool on every successful file_read and
   * implicitly on every successful write (the writer KNOWS what it just
   * wrote — without this self-stamp, a parent's own follow-up write would
   * be refused against its own previous one, breaking the §4.1 no-op
   * invariant for today's single-writer world).
   */
  stampRead(agent: LedgerAgent, relPath: string): void {
    let stamps = this.readStamps.get(agent);
    if (!stamps) {
      stamps = new Map();
      this.readStamps.set(agent, stamps);
    }
    stamps.set(relPath, this.generation(relPath));
  }

  /**
   * THE write gate. Ordered checks per §4.2: lease first, staleness second,
   * then — and only then — the mutation runs under the lease. The check-then-
   * acquire sequence is deliberately synchronous (no await between), so on
   * Node's single event loop it is atomic: a second run() for the same path
   * either lands entirely before the first (lease free) or sees the holder.
   *
   * perform() runs INSIDE the lease: FileTool's read-anchor-write sequence
   * cannot interleave with any other writer's. A perform() crash releases the
   * lease, bumps nothing, and emits nothing (the ordinary tool error is the
   * whole story — the owner's Q4 ruling).
   *
   * A held lease refuses ANY second runner including the same agent — no
   * self special case: same-agent overlap on one path is a caller bug, and
   * fail-closed is the design's only mode.
   */
  async run(
    agent: LedgerAgent,
    relPath: string,
    op: MutationOp,
    perform: () => Promise<MutationDigests>,
  ): Promise<FileMutationEvent> {
    const generationBefore = this.generation(relPath);

    // §4.2 check 2 — the lease. No special case for self: overlap is a bug.
    const holder = this.leases.get(relPath);
    if (holder !== undefined) {
      return {
        agent,
        op,
        path: relPath,
        generationBefore,
        generationAfter: generationBefore,
        bytesBefore: 0,
        bytesAfter: 0,
        shaBefore: null,
        shaAfter: null,
        outcome: 'refused-lease',
        conflictWith: holder,
      };
    }

    // §4.2 check 3 — staleness. Missing stamp ≡ 0 ≡ "never saw the file",
    // which equals the generation of a never-written path, so creating a new
    // file without a prior read is legitimately fresh, not stale.
    const stamp = this.readStamp(agent, relPath);
    if (stamp !== generationBefore) {
      return {
        agent,
        op,
        path: relPath,
        generationBefore,
        generationAfter: generationBefore,
        bytesBefore: 0,
        bytesAfter: 0,
        shaBefore: null,
        shaAfter: null,
        outcome: 'refused-stale',
        conflictWith: this.lastWriter.get(relPath),
        readStampAt: stamp,
      };
    }

    // Acquire synchronously, operate, always release. Bookkeeping happens
    // under the lease so no second runner can observe a half-applied state.
    this.leases.set(relPath, agent);
    try {
      const digests = await perform();
      const generationAfter = generationBefore + 1;
      this.generations.set(relPath, generationAfter);
      this.lastWriter.set(relPath, agent);
      this.stampRead(agent, relPath); // the writer knows its own result
      return {
        agent,
        op,
        path: relPath,
        generationBefore,
        generationAfter,
        bytesBefore: digests.bytesBefore,
        bytesAfter: digests.bytesAfter,
        shaBefore: digests.shaBefore,
        shaAfter: digests.shaAfter,
        outcome: 'applied',
      };
    } finally {
      if (this.leases.get(relPath) === agent) this.leases.delete(relPath);
    }
  }
}
