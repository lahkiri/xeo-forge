import { describe, it, expect } from 'vitest';
import { describeEvent } from '../lib/agent/events';

/* ------------------------------------------------------------------ */
/*  Terminal-event labelling.                                          */
/*                                                                     */
/*  failRun() emits BOTH `error` (the cause) and `done` (the terminal   */
/*  transition). Round-2 QA saw two adjacent rows both reading "Run     */
/*  failed" and could not tell whether it was a duplicate-emission bug  */
/*  or two distinct events. The events are correct; the labels were     */
/*  not. These tests lock the distinction in.                          */
/* ------------------------------------------------------------------ */

describe('Terminal events are distinguishable in the timeline', () => {
  it('labels the cause and the transition differently', () => {
    const cause = describeEvent('error', { message: 'No global model is configured.' });
    const transition = describeEvent('done', { status: 'failed' });

    expect(cause?.title).not.toBe(transition?.title);
  });

  it('reports the error as the cause, carrying the message', () => {
    const label = describeEvent('error', { message: 'No global model is configured.' });
    expect(label?.title).toBe('Error');
    expect(label?.detail).toBe('No global model is configured.');
    expect(label?.tone).toBe('bad');
  });

  it('reports the terminal transition with its status', () => {
    expect(describeEvent('done', { status: 'failed' })?.title).toBe('Run ended: failed');
    expect(describeEvent('done', { status: 'completed' })?.title).toBe('Run completed');
  });

  it('never uses the word "failed" alone for both events', () => {
    const titles = [
      describeEvent('error', { message: 'x' })?.title,
      describeEvent('done', { status: 'failed' })?.title,
    ];
    expect(new Set(titles).size).toBe(2);
  });

  it('keeps a successful terminal transition tonally positive', () => {
    expect(describeEvent('done', { status: 'completed' })?.tone).toBe('good');
  });
});
