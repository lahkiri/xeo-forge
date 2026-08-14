import type { TaskMode } from '../types';

/** Build runs must carry a non-empty, user-approved plan snapshot. */
export function hasApprovedPlan(plan: string | null | undefined): boolean {
  return typeof plan === 'string' && plan.trim().length > 0;
}

export function canStartAgentRun(mode: TaskMode, approvedPlan?: string | null): boolean {
  return mode !== 'build' || hasApprovedPlan(approvedPlan);
}
