import { describe, expect, it } from 'vitest';
import type { TaskMode } from '@/lib/types';
import { canStartAgentRun, hasApprovedPlan } from '@/lib/agent/build-policy';
import { shouldForwardPreviewResponseHeader } from '@/lib/agent/preview-headers';

describe('build authorization policy', () => {
  it('requires a non-empty approved plan for build runs', () => {
    expect(hasApprovedPlan(null)).toBe(false);
    expect(hasApprovedPlan('   ')).toBe(false);
    expect(canStartAgentRun('build' as TaskMode, null)).toBe(false);
    expect(canStartAgentRun('build' as TaskMode, 'Plan: create the app')).toBe(true);
  });

  it('allows planning runs without an approved plan', () => {
    expect(canStartAgentRun('planning' as TaskMode, null)).toBe(true);
  });
});

describe('preview response header policy', () => {
  it.each([
    'set-cookie',
    'location',
    'content-security-policy',
    'x-frame-options',
    'connection',
    'www-authenticate',
  ])('strips untrusted header: %s', (header) => {
    expect(shouldForwardPreviewResponseHeader(header)).toBe(false);
    expect(shouldForwardPreviewResponseHeader(header.toUpperCase())).toBe(false);
  });

  it.each(['content-type', 'cache-control', 'etag', 'x-content-type-options'])(
    'forwards safe header: %s',
    (header) => {
      expect(shouldForwardPreviewResponseHeader(header)).toBe(true);
    },
  );
});
