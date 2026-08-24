import { describe, it, expect } from 'vitest';
import type { TaskEvent, Message } from '../lib/types';
import {
  CURRENT_RUN_TURN_ID,
  SYNTHETIC_GOAL_TURN_ID,
  buildTimeline,
  canFollowUp,
  derivePhase,
  isRunningStatus,
  isTerminalStatus,
  isToolEvent,
  lastDoneSeq,
  latestEventOfType,
  parseEvents,
  shouldStreamStatus,
  splitRuns,
  stripTurnFraming,
} from '../lib/agent/timeline';

/* ------------------------------------------------------------------ */
/* These tests exercise lib/agent/timeline.ts — the SAME module the    */
/* task page imports. They used to carry a private copy of the logic   */
/* that had already diverged from the component.                       */
/* ------------------------------------------------------------------ */

function makeEvent(seq: number, type: string, data: Record<string, unknown>): TaskEvent {
  return {
    id: seq,
    task_id: 'task-1',
    seq,
    type,
    content: JSON.stringify(data),
    created_at: '2025-01-01T00:00:00Z',
  };
}

function makeMsg(id: number, role: Message['role'], content: string): Message {
  return {
    id,
    task_id: 'task-1',
    role,
    content,
    active: 1,
    created_at: '2025-01-01T00:00:00Z',
  };
}

const GOAL = 'Create a file';

function timelineOf(events: TaskEvent[], messages: Message[], status: string) {
  return buildTimeline({ events: parseEvents(events), messages, status, goal: GOAL });
}

describe('parseEvents', () => {
  it('parses TaskEvent array into ParsedEvent array', () => {
    const parsed = parseEvents([makeEvent(1, 'text', { delta: 'hello' })]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].seq).toBe(1);
    expect(parsed[0].type).toBe('text');
    expect(parsed[0].data.delta).toBe('hello');
  });

  it('handles malformed JSON gracefully', () => {
    const bad: TaskEvent[] = [
      { id: 1, task_id: 't', seq: 1, type: 'text', content: 'not-json', created_at: '' },
    ];
    expect(parseEvents(bad)[0].data.raw).toBe('not-json');
  });

  it('resolves created_at into an epoch timestamp', () => {
    const parsed = parseEvents([makeEvent(1, 'text', { delta: 'x' })]);
    expect(parsed[0].ts).toBe(Date.parse('2025-01-01T00:00:00Z'));
  });

  it('falls back to now for an unparseable created_at', () => {
    const before = Date.now();
    const parsed = parseEvents([
      { id: 1, task_id: 't', seq: 1, type: 'text', content: '{}', created_at: 'garbage' },
    ]);
    expect(parsed[0].ts).toBeGreaterThanOrEqual(before);
  });

  it('classifies tool events', () => {
    const parsed = parseEvents([
      makeEvent(1, 'tool_call', {}),
      makeEvent(2, 'tool_result', {}),
      makeEvent(3, 'text', {}),
      makeEvent(4, 'verification', {}),
    ]);
    expect(parsed.filter(isToolEvent).map((e) => e.seq)).toEqual([1, 2]);
  });
});

describe('Timeline: run boundary splitting', () => {
  it('uses seq 0 when no done events exist (first run)', () => {
    const events = parseEvents([
      makeEvent(1, 'text', { delta: 'a' }),
      makeEvent(2, 'tool_call', { name: 'file_list' }),
    ]);
    expect(lastDoneSeq(events)).toBe(0);
    expect(splitRuns(events).currentRunEvents).toHaveLength(2);
  });

  it('splits at the last done event', () => {
    const events = parseEvents([
      makeEvent(1, 'text', { delta: 'run1' }),
      makeEvent(2, 'done', { status: 'completed' }),
      makeEvent(3, 'text', { delta: 'run2' }),
      makeEvent(4, 'tool_call', { name: 'file_read' }),
    ]);
    expect(lastDoneSeq(events)).toBe(2);
    const { currentRunEvents } = splitRuns(events);
    expect(currentRunEvents.map((e) => e.seq)).toEqual([3, 4]);
  });

  it('handles multiple done events (multiple runs)', () => {
    const events = parseEvents([
      makeEvent(1, 'done', { status: 'completed' }),
      makeEvent(2, 'text', { delta: 'run2' }),
      makeEvent(3, 'done', { status: 'completed' }),
      makeEvent(4, 'text', { delta: 'run3' }),
    ]);
    expect(lastDoneSeq(events)).toBe(3);
    const { currentRunEvents, currentRunText } = splitRuns(events);
    expect(currentRunEvents).toHaveLength(1);
    expect(currentRunText).toBe('run3');
  });

  it('concatenates text deltas of the live run only', () => {
    const events = parseEvents([
      makeEvent(1, 'text', { delta: 'old' }),
      makeEvent(2, 'done', { status: 'completed' }),
      makeEvent(3, 'text', { delta: 'New ' }),
      makeEvent(4, 'text', { delta: 'response' }),
    ]);
    expect(splitRuns(events).currentRunText).toBe('New response');
  });

  it('ignores non-string text deltas', () => {
    const events = parseEvents([makeEvent(1, 'text', { delta: 42 })]);
    expect(splitRuns(events).currentRunText).toBe('');
  });

  it('groups tool events per completed run', () => {
    const events = parseEvents([
      makeEvent(1, 'tool_call', { name: 'a' }),
      makeEvent(2, 'done', { status: 'completed' }),
      makeEvent(3, 'tool_call', { name: 'b' }),
      makeEvent(4, 'tool_result', { name: 'b' }),
      makeEvent(5, 'done', { status: 'completed' }),
    ]);
    const { completedRunToolEvents } = splitRuns(events);
    expect(completedRunToolEvents).toHaveLength(2);
    expect(completedRunToolEvents[0].map((e) => e.data.name)).toEqual(['a']);
    expect(completedRunToolEvents[1]).toHaveLength(2);
  });
});

describe('Timeline: turn framing', () => {
  it('strips <user_task> containment tags', () => {
    expect(stripTurnFraming('<user_task>\nDo the thing\n</user_task>', false)).toBe('Do the thing');
  });

  it('strips the Task: label from the opening turn only', () => {
    expect(stripTurnFraming('Task:\nBuild it', true)).toBe('Build it');
    expect(stripTurnFraming('Task:\nBuild it', false)).toBe('Task:\nBuild it');
  });

  it('leaves ordinary content untouched', () => {
    expect(stripTurnFraming('just a message', true)).toBe('just a message');
  });
});

describe('Timeline: construction from messages + current run', () => {
  it('renders the goal turn (it is a real persisted message)', () => {
    const messages = [
      makeMsg(1, 'user', 'Task:\nCreate a file'),
      makeMsg(2, 'assistant', 'I created it.'),
    ];
    const timeline = timelineOf([], messages, 'completed');
    expect(timeline).toHaveLength(2);
    expect(timeline[0].role).toBe('user');
    expect(timeline[0].content).toBe('Create a file');
    expect(timeline[1].content).toBe('I created it.');
  });

  it('includes all messages in chronological order', () => {
    const messages = [
      makeMsg(1, 'user', 'Task:\nBuild something'),
      makeMsg(2, 'assistant', 'Plan: step 1, step 2'),
      makeMsg(3, 'user', 'Approve it'),
      makeMsg(4, 'assistant', 'Building now...'),
    ];
    const timeline = timelineOf([], messages, 'completed');
    expect(timeline.map((t) => t.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(timeline.map((t) => t.content)).toEqual([
      'Build something',
      'Plan: step 1, step 2',
      'Approve it',
      'Building now...',
    ]);
  });

  it('appends the streaming turn when running', () => {
    const messages = [makeMsg(1, 'user', 'Task:\nHello'), makeMsg(2, 'assistant', 'First response')];
    const events = [
      makeEvent(1, 'done', { status: 'completed' }),
      makeEvent(2, 'text', { delta: 'New ' }),
      makeEvent(3, 'text', { delta: 'response' }),
    ];
    const timeline = timelineOf(events, messages, 'running');
    expect(timeline).toHaveLength(3);
    expect(timeline[2].id).toBe(CURRENT_RUN_TURN_ID);
    expect(timeline[2].role).toBe('assistant');
    expect(timeline[2].content).toBe('New response');
  });

  it('appends the streaming turn on pending too (runner not yet started)', () => {
    const messages = [makeMsg(1, 'user', 'Task:\nHello')];
    const timeline = timelineOf([makeEvent(1, 'text', { delta: 'warming up' })], messages, 'pending');
    expect(timeline[timeline.length - 1].id).toBe(CURRENT_RUN_TURN_ID);
  });

  it('does not append a streaming turn when completed (DB messages are authoritative)', () => {
    const messages = [makeMsg(1, 'user', 'Task:\nHello'), makeMsg(2, 'assistant', 'Done')];
    const events = [makeEvent(1, 'text', { delta: 'Done' }), makeEvent(2, 'done', { status: 'completed' })];
    const timeline = timelineOf(events, messages, 'completed');
    expect(timeline).toHaveLength(2);
    expect(timeline.some((t) => t.id === CURRENT_RUN_TURN_ID)).toBe(false);
  });

  it('does not append an empty streaming turn', () => {
    const messages = [makeMsg(1, 'user', 'Task:\nHello')];
    const timeline = timelineOf([makeEvent(1, 'context', { percentage: 3 })], messages, 'running');
    expect(timeline).toHaveLength(1);
  });

  it('reconstructs the goal turn for legacy threads with no messages', () => {
    const timeline = timelineOf([], [], 'completed');
    expect(timeline).toHaveLength(1);
    expect(timeline[0].id).toBe(SYNTHETIC_GOAL_TURN_ID);
    expect(timeline[0].content).toBe(GOAL);
  });
});

describe('Timeline: tool events attached to assistant turns', () => {
  it('nests tool_call and tool_result inside the streaming bubble', () => {
    const messages = [makeMsg(1, 'user', 'Task:\nGoal')];
    const events = [
      makeEvent(1, 'text', { delta: 'Looking...' }),
      makeEvent(2, 'tool_call', { name: 'file_list', args: {} }),
      makeEvent(3, 'tool_result', { name: 'file_list', ok: true, result: '[]' }),
      makeEvent(4, 'text', { delta: 'Empty workspace' }),
    ];
    const timeline = timelineOf(events, messages, 'running');
    const streaming = timeline[timeline.length - 1];
    expect(streaming.toolEvents).toHaveLength(2);
    expect(streaming.toolEvents![0].type).toBe('tool_call');
    expect(streaming.toolEvents![1].type).toBe('tool_result');
    expect(streaming.content).toBe('Looking...Empty workspace');
  });

  it('leaves toolEvents undefined when a run used no tools', () => {
    const messages = [makeMsg(1, 'user', 'Task:\nGoal'), makeMsg(2, 'assistant', 'Just text')];
    const events = [makeEvent(1, 'text', { delta: 'Just text' }), makeEvent(2, 'done', { status: 'completed' })];
    const timeline = timelineOf(events, messages, 'completed');
    expect(timeline[1].toolEvents).toBeUndefined();
  });

  it('attaches a completed run\'s tool events to that run\'s assistant turn', () => {
    const messages = [makeMsg(1, 'user', 'Task:\nGoal'), makeMsg(2, 'assistant', 'I created the file')];
    const events = [
      makeEvent(1, 'tool_call', { name: 'file_write' }),
      makeEvent(2, 'tool_result', { name: 'file_write', ok: true }),
      makeEvent(3, 'done', { status: 'completed' }),
    ];
    const timeline = timelineOf(events, messages, 'completed');
    expect(timeline[1].toolEvents).toHaveLength(2);
    expect(timeline[1].toolEvents![0].data.name).toBe('file_write');
  });

  it('maps run N tool events onto assistant turn N across multiple runs', () => {
    const messages = [
      makeMsg(1, 'user', 'Task:\nGoal'),
      makeMsg(2, 'assistant', 'run one'),
      makeMsg(3, 'user', 'again'),
      makeMsg(4, 'assistant', 'run two'),
    ];
    const events = [
      makeEvent(1, 'tool_call', { name: 'first' }),
      makeEvent(2, 'done', { status: 'completed' }),
      makeEvent(3, 'tool_call', { name: 'second' }),
      makeEvent(4, 'done', { status: 'completed' }),
    ];
    const timeline = timelineOf(events, messages, 'completed');
    expect(timeline[1].toolEvents![0].data.name).toBe('first');
    expect(timeline[3].toolEvents![0].data.name).toBe('second');
  });
});

describe('Timeline: system messages (compaction summaries)', () => {
  it('renders system messages as timeline turns', () => {
    const messages = [
      makeMsg(1, 'user', 'Task:\nGoal'),
      makeMsg(2, 'system', 'Compaction summary of earlier conversation'),
      makeMsg(3, 'assistant', 'After compaction'),
    ];
    const timeline = timelineOf([], messages, 'completed');
    expect(timeline.map((t) => t.role)).toEqual(['user', 'system', 'assistant']);
    expect(timeline[1].content).toBe('Compaction summary of earlier conversation');
  });

  it('does not consume a run slot for system turns', () => {
    const messages = [
      makeMsg(1, 'user', 'Task:\nGoal'),
      makeMsg(2, 'system', 'summary'),
      makeMsg(3, 'assistant', 'answer'),
    ];
    const events = [makeEvent(1, 'tool_call', { name: 'only' }), makeEvent(2, 'done', {})];
    const timeline = timelineOf(events, messages, 'completed');
    expect(timeline[1].toolEvents).toBeUndefined();
    expect(timeline[2].toolEvents![0].data.name).toBe('only');
  });
});

describe('Status predicates', () => {
  it('treats pending and running as non-terminal (SSE stays open)', () => {
    for (const s of ['pending', 'running', 'planned', 'awaiting_decision']) {
      expect(isTerminalStatus(s)).toBe(false);
      expect(shouldStreamStatus(s)).toBe(true);
    }
  });

  it('treats completed and failed as terminal (SSE closes)', () => {
    for (const s of ['completed', 'failed']) {
      expect(isTerminalStatus(s)).toBe(true);
      expect(shouldStreamStatus(s)).toBe(false);
    }
  });

  it('marks only pending and running as running', () => {
    expect(isRunningStatus('running')).toBe(true);
    expect(isRunningStatus('pending')).toBe(true);
    expect(isRunningStatus('planned')).toBe(false);
    expect(isRunningStatus('completed')).toBe(false);
  });

  it('re-opens the stream after a completed → pending follow-up', () => {
    let status = 'completed';
    expect(shouldStreamStatus(status)).toBe(false);
    status = 'pending';
    expect(shouldStreamStatus(status)).toBe(true);
  });
});

describe('Follow-up gating', () => {
  it('blocks follow-up on running and pending tasks', () => {
    expect(canFollowUp('running')).toBe(false);
    expect(canFollowUp('pending')).toBe(false);
  });

  it('allows follow-up on completed, failed and planned tasks', () => {
    expect(canFollowUp('completed')).toBe(true);
    expect(canFollowUp('failed')).toBe(true);
    expect(canFollowUp('planned')).toBe(true);
  });
});

describe('Phase derivation', () => {
  it('reports done for terminal tasks', () => {
    expect(derivePhase({ status: 'completed', isChat: false, currentRunEvents: [] })).toBe('done');
    expect(derivePhase({ status: 'failed', isChat: false, currentRunEvents: [] })).toBe('done');
  });

  it('reports plan while awaiting approval', () => {
    expect(derivePhase({ status: 'planned', isChat: false, currentRunEvents: [] })).toBe('plan');
  });

  it('reports execute once tool activity appears', () => {
    const events = parseEvents([makeEvent(1, 'tool_call', { name: 'file_write' })]);
    expect(derivePhase({ status: 'running', isChat: false, currentRunEvents: events })).toBe('execute');
  });

  it('reports verify once a verification event appears', () => {
    const events = parseEvents([
      makeEvent(1, 'tool_call', { name: 'file_write' }),
      makeEvent(2, 'verification', { status: 'pass' }),
    ]);
    expect(derivePhase({ status: 'running', isChat: false, currentRunEvents: events })).toBe('verify');
  });

  it('reports plan for a running task with no activity yet', () => {
    expect(derivePhase({ status: 'running', isChat: false, currentRunEvents: [] })).toBe('plan');
  });
});

describe('latestEventOfType', () => {
  it('returns the most recent matching event', () => {
    const events = parseEvents([
      makeEvent(1, 'error', { message: 'first' }),
      makeEvent(2, 'text', { delta: 'x' }),
      makeEvent(3, 'error', { message: 'second' }),
    ]);
    expect(latestEventOfType(events, 'error')!.data.message).toBe('second');
  });

  it('returns undefined when absent', () => {
    expect(latestEventOfType(parseEvents([makeEvent(1, 'text', {})]), 'error')).toBeUndefined();
  });
});
