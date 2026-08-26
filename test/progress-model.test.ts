/**
 * Progress model contract (v1.20).
 *
 * These tests encode the intellectual upgrade: stagnation is the ABSENCE of
 * progress, not the PRESENCE of repetition. Each case is one claim about the
 * loop's behavior that a counter-based guard got wrong.
 */
import { describe, it, expect } from 'vitest';
import {
  ProgressModel,
  InformationGainTracker,
  errorClass,
  type IterationObservation,
} from '../lib/agent/progress';

function obs(overrides: Partial<IterationObservation> = {}): IterationObservation {
  return {
    signature: 'sig',
    filesRead: [],
    filesChanged: [],
    commandExitCodes: [],
    errors: [],
    ...overrides,
  };
}

describe('ProgressModel — repetition with movement is work', () => {
  it('treats an iterated test-fix loop as progress even with an identical signature', () => {
    // The exact case the old counter punished: same two tools every round.
    const model = new ProgressModel({ idleWindow: 3, postNudgeGrace: 1 });
    const verdicts = [];
    for (let round = 0; round < 8; round += 1) {
      verdicts.push(
        model.record(
          obs({
            signature: 'code_execute:npm test|file_edit:src/a.ts',
            filesChanged: ['src/a.ts'],
            commandExitCodes: [1],
            errors: [`AssertionError: expected ${round} received ${round + 1}`],
          }),
        ),
      );
    }
    expect(verdicts.every((v) => v.kind === 'progress')).toBe(true);
  });

  it('counts a changed test outcome as progress even with no file edits', () => {
    const model = new ProgressModel({ idleWindow: 2, postNudgeGrace: 1 });
    model.record(obs({ commandExitCodes: [1] }));
    const verdict = model.record(obs({ commandExitCodes: [0] }));
    expect(verdict.kind).toBe('progress');
    if (verdict.kind === 'progress') expect(verdict.signal.testOutcomeChanged).toBe(true);
  });

  it('counts a NEW error class as progress — a different failure is information', () => {
    const model = new ProgressModel({ idleWindow: 2, postNudgeGrace: 1 });
    model.record(obs({ errors: ['TypeError: cannot read property x of undefined'] }));
    const verdict = model.record(obs({ errors: ['AssertionError: expected 2 to equal 3'] }));
    expect(verdict.kind).toBe('progress');
    if (verdict.kind === 'progress') expect(verdict.signal.errorClassChanged).toBe(true);
  });

  it('does NOT count the same error class again as progress', () => {
    const model = new ProgressModel({ idleWindow: 2, postNudgeGrace: 5 });
    model.record(obs({ errors: ['AssertionError: expected 2 to equal 3'] }));
    // Same fault, different numbers — same class, so no new information.
    const verdict = model.record(obs({ errors: ['AssertionError: expected 9 to equal 4'] }));
    if (verdict.kind === 'progress') {
      expect(verdict.signal.errorClassChanged).toBe(false);
      expect(verdict.signal.madeProgress).toBe(false);
    }
  });
});

describe('ProgressModel — movement-free loops are caught', () => {
  it('nudges after the idle window when nothing changes', () => {
    const model = new ProgressModel({ idleWindow: 3, postNudgeGrace: 2 });
    expect(model.record(obs()).kind).toBe('progress');
    expect(model.record(obs()).kind).toBe('progress');
    const third = model.record(obs());
    expect(third.kind).toBe('nudge');
    if (third.kind === 'nudge') expect(third.idleIterations).toBe(3);
  });

  it('catches alternating re-reads that a fingerprint window would forgive', () => {
    // Two DIFFERENT signatures alternating forever: the old identical-window
    // guard never fires, because no window is uniform. Progress does fire,
    // because re-reading known files teaches nothing.
    const model = new ProgressModel({ idleWindow: 3, postNudgeGrace: 2 });
    model.record(obs({ signature: 'read:a', filesRead: ['a.ts'] })); // new -> progress
    model.record(obs({ signature: 'read:b', filesRead: ['b.ts'] })); // new -> progress
    const verdicts = [];
    for (let i = 0; i < 6; i += 1) {
      verdicts.push(
        model.record(obs({ signature: i % 2 ? 'read:a' : 'read:b', filesRead: [i % 2 ? 'a.ts' : 'b.ts'] })),
      );
    }
    expect(verdicts.some((v) => v.kind === 'nudge')).toBe(true);
    expect(verdicts.some((v) => v.kind === 'stuck')).toBe(true);
  });

  it('escalates to stuck only after the nudge was already spent', () => {
    const model = new ProgressModel({ idleWindow: 2, postNudgeGrace: 2 });
    expect(model.record(obs()).kind).toBe('progress');
    expect(model.record(obs()).kind).toBe('nudge');
    expect(model.record(obs()).kind).toBe('progress'); // grace
    const last = model.record(obs());
    expect(last.kind).toBe('stuck');
  });

  it('resets the nudge budget when the agent recovers', () => {
    const model = new ProgressModel({ idleWindow: 2, postNudgeGrace: 2 });
    model.record(obs());
    expect(model.record(obs()).kind).toBe('nudge');
    expect(model.hasNudged).toBe(true);
    model.record(obs({ filesChanged: ['fixed.ts'] })); // real work
    expect(model.hasNudged).toBe(false);
    // Full window available again.
    model.record(obs());
    expect(model.record(obs()).kind).toBe('nudge');
  });

  it('counts a repeat edit to the same file as progress but a repeat read as not', () => {
    const model = new ProgressModel({ idleWindow: 5, postNudgeGrace: 5 });
    const edit1 = model.record(obs({ filesChanged: ['x.ts'] }));
    const edit2 = model.record(obs({ filesChanged: ['x.ts'] }));
    expect(edit1.kind).toBe('progress');
    expect(edit2.kind).toBe('progress');
    const read1 = model.record(obs({ filesRead: ['y.ts'] }));
    const read2 = model.record(obs({ filesRead: ['y.ts'] }));
    if (read1.kind === 'progress') expect(read1.signal.newFilesRead).toBe(1);
    if (read2.kind === 'progress') expect(read2.signal.newFilesRead).toBe(0);
  });

  it('records a signal per iteration for the evidence bundle', () => {
    const model = new ProgressModel();
    model.record(obs({ filesRead: ['a'] }));
    model.record(obs({ filesChanged: ['b'] }));
    expect(model.signals).toHaveLength(2);
    expect(model.signals[1].newFilesChanged).toBe(1);
  });
});

describe('errorClass', () => {
  it('collapses churn (numbers, quotes, paths) but keeps the fault identity', () => {
    expect(errorClass('AssertionError: expected 3 got 4')).toBe(
      errorClass('AssertionError: expected 71 got 92'),
    );
    expect(errorClass('TypeError: x is not a function')).not.toBe(
      errorClass('AssertionError: x is not a function'),
    );
  });

  it('treats different files in the same error shape as one class', () => {
    expect(errorClass('ENOENT: no such file /a/b/c.ts')).toBe(
      errorClass('ENOENT: no such file /q/r/s.ts'),
    );
  });
});

describe('InformationGainTracker — gain replaces a fixed read ceiling', () => {
  it('keeps exploration productive while files are new', () => {
    const tracker = new InformationGainTracker(3);
    for (let i = 0; i < 25; i += 1) {
      const gain = tracker.record(`file${i}.ts`, `hash${i}`, 4);
      expect(gain.productive).toBe(true);
    }
    // 25 reads without a single nudge — the ceiling was the wrong instrument.
    expect(tracker.lowGainRun).toBe(0);
  });

  it('flags an agent re-reading the same content', () => {
    const tracker = new InformationGainTracker(3);
    tracker.record('a.ts', 'h1');
    const results = [
      tracker.record('a.ts', 'h1'),
      tracker.record('a.ts', 'h1'),
      tracker.record('a.ts', 'h1'),
      tracker.record('a.ts', 'h1'),
    ];
    expect(results.at(-1)!.productive).toBe(false);
    expect(results.at(-1)!.reason).toContain('already in');
  });

  it('scores a changed file as fresh even on a second visit', () => {
    const tracker = new InformationGainTracker(2);
    tracker.record('a.ts', 'hash-before');
    const after = tracker.record('a.ts', 'hash-after');
    expect(after.productive).toBe(true);
    expect(after.reason).toContain('changed content');
  });
});
