/**
 * Single source of truth for credit pricing.
 * Keep this tiny and flat — no tiers, no per-user pricing (AGENTS.md: one global model).
 */
export const TASK_CREATE_COST = Number(process.env.CREDIT_TASK_CREATE || '2');
export const CREDITS_PER_TOOL_CALL = Number(process.env.CREDIT_PER_TOOL_CALL || '1');
