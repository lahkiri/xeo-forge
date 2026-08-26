/**
 * Progress model (v1.20) — replaces counter-based stagnation detection.
 *
 * The old guard asked "did the agent repeat itself N times?". That question
 * punishes a legitimate test-fix loop (same two tools, every round) and
 * forgives a useless one (alternating two reads forever). The right question
 * is "did the world change?".
 *
 * A ProgressSignal is computed per iteration from observable facts the loop
 * already tracks. Stagnation is now the ABSENCE of progress across a window,
 * not the PRESENCE of repetition. Repetition with movement is work.
 *
 * Deliberately pure: no DB, no events, no I/O. The loop feeds it observations
 * and reads a verdict back, which is what makes it testable in isolation.
 */

/** Observable state captured at the end of one loop iteration. */
export interface IterationObservation {
  /** Tool-call fingerprint for the iteration (name+args+truncated result). */
  signature: string;
  /** Workspace-relative paths read during this iteration. */
  filesRead: string[];
  /** Workspace-relative paths written/edited during this iteration. */
  filesChanged: string[];
  /**
   * Exit codes of commands executed this iteration. A changed pass/fail shape
   * is one of the strongest progress signals available — it means reality
   * responded differently than last time.
   */
  commandExitCodes: number[];
  /**
   * Error text observed this iteration (test failures, stack traces, tool
   * errors). Used for error-class comparison: a DIFFERENT error after a fix
   * is progress even though the run still fails.
   */
  errors: string[];
  /** Whether the agent's own task/todo state moved this iteration. */
  taskStateChanged?: boolean;
}

/** Derived, comparable progress facts for one iteration. */
export interface ProgressSignal {
  newFilesRead: number;
  newFilesChanged: number;
  testOutcomeChanged: boolean;
  errorClassChanged: boolean;
  newEvidence: boolean;
  taskStateChanged: boolean;
  /** Composite: did anything at all move? */
  madeProgress: boolean;
}

export type ProgressVerdict =
  /** Something moved — let the agent work. */
  | { kind: 'progress'; signal: ProgressSignal }
  /**
   * Nothing moved for `window` consecutive iterations, but the budget for a
   * corrective nudge has not been spent yet.
   */
  | { kind: 'nudge'; idleIterations: number; reason: string }
  /** Nothing moved even after the nudge — the run should be failed. */
  | { kind: 'stuck'; idleIterations: number; reason: string };

export interface ProgressModelOptions {
  /**
   * Consecutive zero-progress iterations before nudging. Frontier models get
   * more room: their repeated shapes are usually deliberate.
   */
  idleWindow?: number;
  /** Extra zero-progress iterations allowed AFTER the nudge before failing. */
  postNudgeGrace?: number;
}

/**
 * Normalize an error string to its CLASS, so "expected 3 got 4" and
 * "expected 3 got 7" collapse to the same class while a genuinely different
 * failure (TypeError vs AssertionError) does not.
 *
 * Numbers, quoted literals, hex addresses, and absolute paths are the parts
 * that churn between identical failures; everything else identifies the fault.
 */
export function errorClass(error: string): string {
  return error
    .toLowerCase()
    .replace(/0x[0-9a-f]+/g, '#')
    .replace(/\d+/g, '#')
    .replace(/'[^']*'/g, 'S')
    .replace(/"[^"]*"/g, 'S')
    .replace(/[a-z]:[\\/][^\s:]+/g, 'P')
    .replace(/\/[^\s:]+/g, 'P')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}

/**
 * Tracks progress across a run. One instance per agent run.
 *
 * Usage from the loop:
 *   const verdict = progress.record({ signature, filesRead, ... });
 *   if (verdict.kind === 'nudge') messages.push(nudge);
 *   if (verdict.kind === 'stuck') await failRun(...);
 */
export class ProgressModel {
  private readonly idleWindow: number;
  private readonly postNudgeGrace: number;

  private readonly seenFilesRead = new Set<string>();
  private readonly seenFilesChanged = new Set<string>();
  private readonly seenErrorClasses = new Set<string>();
  private lastExitCodeShape: string | null = null;

  private idleIterations = 0;
  private nudged = false;
  /** Every signal computed so far — useful for evidence bundles and tests. */
  private readonly history: ProgressSignal[] = [];

  constructor(options: ProgressModelOptions = {}) {
    this.idleWindow = options.idleWindow ?? 4;
    this.postNudgeGrace = options.postNudgeGrace ?? 2;
  }

  /** Signals recorded so far, oldest first. */
  get signals(): readonly ProgressSignal[] {
    return this.history;
  }

  /** Whether the model has already spent its nudge. */
  get hasNudged(): boolean {
    return this.nudged;
  }

  record(observation: IterationObservation): ProgressVerdict {
    const signal = this.computeSignal(observation);
    this.history.push(signal);

    if (signal.madeProgress) {
      // Real movement resets the idle counter AND the nudge budget: an agent
      // that recovers deserves the same headroom it started with.
      this.idleIterations = 0;
      this.nudged = false;
      return { kind: 'progress', signal };
    }

    this.idleIterations += 1;

    if (this.idleIterations >= this.idleWindow + this.postNudgeGrace && this.nudged) {
      return {
        kind: 'stuck',
        idleIterations: this.idleIterations,
        reason:
          `No measurable progress for ${this.idleIterations} consecutive iterations ` +
          `(no new files read or changed, no test-outcome change, no new error class, ` +
          `no task-state change) — including after an explicit corrective nudge.`,
      };
    }

    if (this.idleIterations >= this.idleWindow && !this.nudged) {
      this.nudged = true;
      return {
        kind: 'nudge',
        idleIterations: this.idleIterations,
        reason:
          `${this.idleIterations} iterations produced no new information and no ` +
          `state change. Repeating an action is fine when the result changes; it is ` +
          `not fine when nothing changes.`,
      };
    }

    return { kind: 'progress', signal };
  }

  private computeSignal(observation: IterationObservation): ProgressSignal {
    let newFilesRead = 0;
    for (const path of observation.filesRead) {
      if (!this.seenFilesRead.has(path)) {
        this.seenFilesRead.add(path);
        newFilesRead += 1;
      }
    }

    let newFilesChanged = 0;
    for (const path of observation.filesChanged) {
      // A file changed AGAIN is still progress: the second edit is new work,
      // unlike a second read of unchanged content.
      newFilesChanged += 1;
      this.seenFilesChanged.add(path);
    }

    const exitShape = observation.commandExitCodes.length
      ? observation.commandExitCodes.map((c) => (c === 0 ? 'ok' : 'fail')).join(',')
      : null;
    const testOutcomeChanged =
      exitShape !== null && this.lastExitCodeShape !== null && exitShape !== this.lastExitCodeShape;
    if (exitShape !== null) this.lastExitCodeShape = exitShape;

    let errorClassChanged = false;
    for (const error of observation.errors) {
      const cls = errorClass(error);
      if (cls && !this.seenErrorClasses.has(cls)) {
        this.seenErrorClasses.add(cls);
        errorClassChanged = true;
      }
    }

    const taskStateChanged = observation.taskStateChanged === true;
    const newEvidence = newFilesRead > 0 || newFilesChanged > 0 || errorClassChanged;

    return {
      newFilesRead,
      newFilesChanged,
      testOutcomeChanged,
      errorClassChanged,
      newEvidence,
      taskStateChanged,
      madeProgress:
        newFilesRead > 0 ||
        newFilesChanged > 0 ||
        testOutcomeChanged ||
        errorClassChanged ||
        taskStateChanged,
    };
  }
}

/**
 * Information gain for exploration, replacing a fixed read ceiling.
 *
 * A hard MAX_READS punishes an agent legitimately mapping an unfamiliar
 * repository and forgives one re-reading the same two files. Gain measures
 * whether reading is still teaching the agent anything.
 */
export interface ReadGain {
  /** 0..1 — share of this read that was new to the run. */
  gain: number;
  /** Whether exploration should continue without a nudge. */
  productive: boolean;
  reason: string;
}

export class InformationGainTracker {
  private readonly seenPaths = new Set<string>();
  private readonly seenContentHashes = new Set<string>();
  private lowGainStreak = 0;

  constructor(
    /** Consecutive low-gain reads tolerated before exploration is nudged. */
    private readonly lowGainTolerance = 4,
  ) {}

  /**
   * @param path      workspace-relative path just read
   * @param contentHash stable digest of what came back (any hash is fine —
   *                    the tracker only compares equality)
   * @param newSymbols count of identifiers/exports the agent had not seen
   */
  record(path: string, contentHash: string, newSymbols = 0): ReadGain {
    const firstVisit = !this.seenPaths.has(path);
    const freshContent = !this.seenContentHashes.has(contentHash);
    this.seenPaths.add(path);
    this.seenContentHashes.add(contentHash);

    let gain = 0;
    if (firstVisit) gain += 0.5;
    if (freshContent) gain += 0.3;
    if (newSymbols > 0) gain += Math.min(0.2, newSymbols * 0.02);
    gain = Math.min(1, gain);

    const productive = gain >= 0.3;
    if (productive) this.lowGainStreak = 0;
    else this.lowGainStreak += 1;

    if (this.lowGainStreak >= this.lowGainTolerance) {
      return {
        gain,
        productive: false,
        reason:
          `${this.lowGainStreak} consecutive reads returned content already in ` +
          `context. Exploration has stopped paying for itself — act on what you know.`,
      };
    }

    return {
      gain,
      productive: true,
      reason: firstVisit
        ? 'new file'
        : freshContent
          ? 'same file, changed content'
          : 'already-seen content',
    };
  }

  get lowGainRun(): number {
    return this.lowGainStreak;
  }
}
