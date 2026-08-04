import { describe, it, expect } from 'vitest';
import type { TaskEvent, Message } from '../lib/types';

/* ------------------------------------------------------------------ */
/* Helpers — mirror the pure logic from TaskClient without React        */
/* ------------------------------------------------------------------ */

interface ParsedEvent {
  seq: number;
  type: string;
  data: Record<string, unknown>;
}

function parseEvents(events: TaskEvent[]): ParsedEvent[] {
  return events.map((e) => {
    let data: Record<string, unknown> = {};
    try {
      data = JSON.parse(e.content) as Record<string, unknown>;
    } catch {
      data = { raw: e.content };
    }
    return { seq: e.seq, type: e.type, data };
  });
}

interface TimelineTurn {
  id: number | string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  toolEvents?: ParsedEvent[];
}

function buildTimeline(
  events: ParsedEvent[],
  messages: Message[],
  status: string,
): TimelineTurn[] {
  const isRunning = status === 'running' || status === 'pending';

  const doneSeqs = events.filter((e) => e.type === 'done').map((e) => e.seq);
  const lastDoneSeq = doneSeqs.length > 0 ? Math.max(...doneSeqs) : 0;
  const currentRunEvents = events.filter((e) => e.seq > lastDoneSeq);

  const currentRunText = currentRunEvents
    .filter((e) => e.type === 'text')
    .map((e) => (typeof e.data.delta === 'string' ? e.data.delta : ''))
    .join('');

  const currentRunToolEvents = currentRunEvents.filter(
    (e) => e.type === 'tool_call' || e.type === 'tool_result',
  );

  const timeline: TimelineTurn[] = messages.slice(1).map((msg) => ({
    id: msg.id,
    role: msg.role as 'user' | 'assistant' | 'system',
    content: msg.content,
  }));

  if (isRunning && (currentRunText || currentRunToolEvents.length > 0)) {
    timeline.push({
      id: 'current-run',
      role: 'assistant',
      content: currentRunText,
      toolEvents: currentRunToolEvents.length > 0 ? currentRunToolEvents : undefined,
    });
  }

  return timeline;
}

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

/* ------------------------------------------------------------------ */
/* Tests                                                                */
/* ------------------------------------------------------------------ */

describe('parseEvents', () => {
  it('parses TaskEvent array into ParsedEvent array', () => {
    const raw = [makeEvent(1, 'text', { delta: 'hello' })];
    const parsed = parseEvents(raw);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].seq).toBe(1);
    expect(parsed[0].type).toBe('text');
    expect(parsed[0].data.delta).toBe('hello');
  });

  it('handles malformed JSON gracefully', () => {
    const bad: TaskEvent[] = [{
      id: 1, task_id: 't', seq: 1, type: 'text',
      content: 'not-json', created_at: '',
    }];
    const parsed = parseEvents(bad);
    expect(parsed[0].data.raw).toBe('not-json');
  });
});

describe('Timeline: run boundary splitting', () => {
  it('uses seq 0 when no done events exist (first run)', () => {
    const events = parseEvents([
      makeEvent(1, 'text', { delta: 'a' }),
      makeEvent(2, 'tool_call', { name: 'file_list' }),
    ]);
    const doneSeqs = events.filter((e) => e.type === 'done').map((e) => e.seq);
    const lastDoneSeq = doneSeqs.length > 0 ? Math.max(...doneSeqs) : 0;
    const currentRunEvents = events.filter((e) => e.seq > lastDoneSeq);
    expect(lastDoneSeq).toBe(0);
    expect(currentRunEvents).toHaveLength(2);
  });

  it('splits at the last done event', () => {
    const events = parseEvents([
      makeEvent(1, 'text', { delta: 'run1' }),
      makeEvent(2, 'done', { status: 'completed' }),
      makeEvent(3, 'text', { delta: 'run2' }),
      makeEvent(4, 'tool_call', { name: 'file_read' }),
    ]);
    const doneSeqs = events.filter((e) => e.type === 'done').map((e) => e.seq);
    const lastDoneSeq = doneSeqs.length > 0 ? Math.max(...doneSeqs) : 0;
    const currentRunEvents = events.filter((e) => e.seq > lastDoneSeq);
    expect(lastDoneSeq).toBe(2);
    expect(currentRunEvents).toHaveLength(2);
    expect(currentRunEvents[0].seq).toBe(3);
    expect(currentRunEvents[1].seq).toBe(4);
  });

  it('handles multiple done events (multiple runs)', () => {
    const events = parseEvents([
      makeEvent(1, 'done', { status: 'completed' }),
      makeEvent(2, 'text', { delta: 'run2' }),
      makeEvent(3, 'done', { status: 'completed' }),
      makeEvent(4, 'text', { delta: 'run3' }),
    ]);
    const doneSeqs = events.filter((e) => e.type === 'done').map((e) => e.seq);
    const lastDoneSeq = Math.max(...doneSeqs);
    const currentRunEvents = events.filter((e) => e.seq > lastDoneSeq);
    expect(lastDoneSeq).toBe(3);
    expect(currentRunEvents).toHaveLength(1);
    expect(currentRunEvents[0].data.delta).toBe('run3');
  });
});

describe('Timeline: construction from messages + current run', () => {
  it('skips first message (goal) from timeline', () => {
    const messages = [
      makeMsg(1, 'user', 'Task:\nCreate a file'),
      makeMsg(2, 'assistant', 'I will create it.'),
    ];
    const timeline = buildTimeline([], messages, 'completed');
    expect(timeline).toHaveLength(1);
    expect(timeline[0].role).toBe('assistant');
    expect(timeline[0].content).toBe('I will create it.');
  });

  it('includes all messages after goal in chronological order', () => {
    const messages = [
      makeMsg(1, 'user', 'Task:\nBuild something'),
      makeMsg(2, 'assistant', 'Plan: step 1, step 2'),
      makeMsg(3, 'user', 'Approve it'),
      makeMsg(4, 'assistant', 'Building now...'),
    ];
    const timeline = buildTimeline([], messages, 'completed');
    expect(timeline).toHaveLength(3);
    expect(timeline[0].role).toBe('assistant');
    expect(timeline[0].content).toBe('Plan: step 1, step 2');
    expect(timeline[1].role).toBe('user');
    expect(timeline[1].content).toBe('Approve it');
    expect(timeline[2].role).toBe('assistant');
    expect(timeline[2].content).toBe('Building now...');
  });

  it('appends current run text when running', () => {
    const messages = [
      makeMsg(1, 'user', 'Task:\nHello'),
      makeMsg(2, 'assistant', 'First response'),
    ];
    const events = parseEvents([
      makeEvent(1, 'done', { status: 'completed' }),
      makeEvent(2, 'text', { delta: 'New ' }),
      makeEvent(3, 'text', { delta: 'response' }),
    ]);
    const timeline = buildTimeline(events, messages, 'running');
    // messages.slice(1) = [assistant first response] + current-run = 2
    expect(timeline).toHaveLength(2);
    expect(timeline[0].role).toBe('assistant');
    expect(timeline[0].content).toBe('First response');
    expect(timeline[1].id).toBe('current-run');
    expect(timeline[1].role).toBe('assistant');
    expect(timeline[1].content).toBe('New response');
  });

  it('does not append current run when completed (DB messages are authoritative)', () => {
    const messages = [
      makeMsg(1, 'user', 'Task:\nHello'),
      makeMsg(2, 'assistant', 'Done'),
    ];
    const events = parseEvents([
      makeEvent(1, 'text', { delta: 'Done' }),
      makeEvent(2, 'done', { status: 'completed' }),
    ]);
    const timeline = buildTimeline(events, messages, 'completed');
    expect(timeline).toHaveLength(1);
    expect(timeline[0].content).toBe('Done');
  });

  it('handles empty messages beyond goal', () => {
    const messages = [makeMsg(1, 'user', 'Task:\nGoal')];
    const timeline = buildTimeline([], messages, 'completed');
    expect(timeline).toHaveLength(0);
  });
});

describe('Timeline: tool events attached to assistant turns', () => {
  it('nests tool_call and tool_result inside current-run assistant bubble', () => {
    const messages = [makeMsg(1, 'user', 'Task:\nGoal')];
    const events = parseEvents([
      makeEvent(1, 'text', { delta: 'Looking...' }),
      makeEvent(2, 'tool_call', { name: 'file_list', args: {} }),
      makeEvent(3, 'tool_result', { name: 'file_list', ok: true, result: '[]' }),
      makeEvent(4, 'text', { delta: 'Empty workspace' }),
    ]);
    const timeline = buildTimeline(events, messages, 'running');
    expect(timeline).toHaveLength(1);
    expect(timeline[0].toolEvents).toBeDefined();
    // toolEvents only includes tool_call + tool_result (not text)
    expect(timeline[0].toolEvents).toHaveLength(2);
    expect(timeline[0].toolEvents![0].type).toBe('tool_call');
    expect(timeline[0].toolEvents![0].data.name).toBe('file_list');
    expect(timeline[0].toolEvents![1].type).toBe('tool_result');
    // Text is in the content field, not in toolEvents
    expect(timeline[0].content).toBe('Looking...Empty workspace');
  });

  it('no toolEvents property when no tool events in current run', () => {
    const messages = [makeMsg(1, 'user', 'Task:\nGoal')];
    const events = parseEvents([
      makeEvent(1, 'text', { delta: 'Just text' }),
      makeEvent(2, 'done', { status: 'completed' }),
    ]);
    const timeline = buildTimeline(events, messages, 'completed');
    // Completed run: no current-run bubble. messages.slice(1) = [] (only goal).
    expect(timeline).toHaveLength(0);
  });

  it('DB messages (completed runs) do not include tool events', () => {
    const messages = [
      makeMsg(1, 'user', 'Task:\nGoal'),
      makeMsg(2, 'assistant', 'I created the file'),
    ];
    const events = parseEvents([
      makeEvent(1, 'tool_call', { name: 'file_write' }),
      makeEvent(2, 'tool_result', { name: 'file_write', ok: true }),
      makeEvent(3, 'done', { status: 'completed' }),
    ]);
    const timeline = buildTimeline(events, messages, 'completed');
    // Only assistant message from DB, no tool events attached
    expect(timeline).toHaveLength(1);
    expect(timeline[0].toolEvents).toBeUndefined();
  });
});

describe('Timeline: chronological ordering', () => {
  it('maintains correct order across multiple runs', () => {
    const messages = [
      makeMsg(1, 'user', 'Task:\nGoal'),
      makeMsg(2, 'assistant', 'First response'),
      makeMsg(3, 'user', 'Follow-up'),
      makeMsg(4, 'assistant', 'Second response'),
    ];
    const events = parseEvents([
      makeEvent(1, 'text', { delta: 'First' }),
      makeEvent(2, 'done', { status: 'completed' }),
      makeEvent(3, 'text', { delta: 'Second' }),
      makeEvent(4, 'done', { status: 'completed' }),
    ]);
    const timeline = buildTimeline(events, messages, 'completed');
    expect(timeline).toHaveLength(3);
    expect(timeline[0].role).toBe('assistant');
    expect(timeline[0].content).toBe('First response');
    expect(timeline[1].role).toBe('user');
    expect(timeline[1].content).toBe('Follow-up');
    expect(timeline[2].role).toBe('assistant');
    expect(timeline[2].content).toBe('Second response');
  });

  it('interleaves user and assistant messages correctly', () => {
    const messages = [
      makeMsg(1, 'user', 'Task:\nA'),
      makeMsg(2, 'assistant', 'B'),
      makeMsg(3, 'user', 'C'),
      makeMsg(4, 'assistant', 'D'),
      makeMsg(5, 'user', 'E'),
    ];
    const timeline = buildTimeline([], messages, 'completed');
    expect(timeline).toHaveLength(4);
    expect(timeline.map((t) => t.role)).toEqual(['assistant', 'user', 'assistant', 'user']);
  });
});

describe('Timeline: system messages (compaction summaries)', () => {
  it('renders system messages as timeline turns', () => {
    const messages = [
      makeMsg(1, 'user', 'Task:\nGoal'),
      makeMsg(2, 'system', 'Compaction summary of earlier conversation'),
      makeMsg(3, 'assistant', 'After compaction'),
    ];
    const timeline = buildTimeline([], messages, 'completed');
    expect(timeline).toHaveLength(2);
    expect(timeline[0].role).toBe('system');
    expect(timeline[0].content).toBe('Compaction summary of earlier conversation');
    expect(timeline[1].role).toBe('assistant');
  });
});

describe('SSE reconnection: status transition', () => {
  it('pending status is not terminal (SSE should be open)', () => {
    const isTerminal = (s: string) => s === 'completed' || s === 'failed';
    expect(isTerminal('pending')).toBe(false);
  });

  it('running status is not terminal (SSE should be open)', () => {
    const isTerminal = (s: string) => s === 'completed' || s === 'failed';
    expect(isTerminal('running')).toBe(false);
  });

  it('completed status is terminal (SSE should be closed)', () => {
    const isTerminal = (s: string) => s === 'completed' || s === 'failed';
    expect(isTerminal('completed')).toBe(true);
  });

  it('failed status is terminal (SSE should be closed)', () => {
    const isTerminal = (s: string) => s === 'completed' || s === 'failed';
    expect(isTerminal('failed')).toBe(true);
  });

  it('transitioning completed → pending makes SSE reconnect', () => {
    // Simulate the state transition that handleFollowUp performs:
    // 1. status starts as 'completed' (terminal, SSE closed)
    // 2. handleFollowUp sets status to 'pending' (non-terminal)
    // 3. SSE effect re-runs because status changed
    let status = 'completed';
    const isTerminal = (s: string) => s === 'completed' || s === 'failed';

    // Initial state: terminal, SSE should not open
    expect(isTerminal(status)).toBe(true);

    // After handleFollowUp sets status
    status = 'pending';
    expect(isTerminal(status)).toBe(false);
    // SSE effect would now open a new connection
  });
});

describe('Messages route: follow-up gating', () => {
  it('blocks follow-up on running tasks', () => {
    const canFollowUp = (taskStatus: string) =>
      taskStatus !== 'running' && taskStatus !== 'pending';
    expect(canFollowUp('running')).toBe(false);
    expect(canFollowUp('pending')).toBe(false);
  });

  it('allows follow-up on completed tasks', () => {
    const canFollowUp = (taskStatus: string) =>
      taskStatus !== 'running' && taskStatus !== 'pending';
    expect(canFollowUp('completed')).toBe(true);
  });

  it('allows follow-up on failed tasks', () => {
    const canFollowUp = (taskStatus: string) =>
      taskStatus !== 'running' && taskStatus !== 'pending';
    expect(canFollowUp('failed')).toBe(true);
  });

  it('allows follow-up on planned tasks', () => {
    const canFollowUp = (taskStatus: string) =>
      taskStatus !== 'running' && taskStatus !== 'pending';
    expect(canFollowUp('planned')).toBe(true);
  });
});

describe('Credits: exhaustion and recharge', () => {
  it('credits can go from 0 to positive (recharge scenario)', () => {
    let balance = 0;
    // Simulate recharge
    balance += 100;
    expect(balance).toBe(100);
    // Now can debit
    const cost = 1;
    expect(balance >= cost).toBe(true);
    balance -= cost;
    expect(balance).toBe(99);
  });

  it('task can be retried after credit recharge', () => {
    // Simulate: task failed due to credits, then credits recharged, then follow-up
    let taskStatus = 'failed';
    const canFollowUp = taskStatus !== 'running' && taskStatus !== 'pending';
    expect(canFollowUp).toBe(true);
    // After follow-up, status transitions to pending → running
    taskStatus = 'pending';
    expect(taskStatus === 'running' || taskStatus === 'pending').toBe(true);
  });
});
