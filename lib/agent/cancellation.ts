/**
 * Run cancellation — cooperative AbortController registry.
 *
 * WHAT THIS IS: the missing "stop" control from the risk register (P1:
 * "لا يوجد cancel/pause/resume حقيقي"). A run registers its controller at
 * start; a cancel route (or any future supervisor) can abort it by task id.
 *
 * WHAT THIS IS NOT: pause/resume/checkpoint — those require durable run
 * state and are documented as the next lifecycle milestone. This layer gives
 * cancellation with REAL propagation (model stream, tool calls) instead of
 * the previous behavior (closing the SSE tab and hoping).
 *
 * HONESTY: cancellation is cooperative. The loop checks the signal between
 * iterations and around model calls; an in-flight long tool (a 20s git
 * command) finishes before the signal is observed. That window is bounded by
 * the per-tool timeouts and is stated here rather than hidden.
 */

/**
 * v1.20.1 (audit A3): the registry MUST be a process-wide singleton. A plain
 * module-level Map is instantiated once per compiled bundle — in dev (and any
 * setup where route bundles load separately) the cancel route's Map and the
 * loop's Map could differ, making cancelRun report "no live loop" while the
 * run kept streaming (observed live: events flowed 97s after a 'successful'
 * cancel). Anchoring on globalThis guarantees one instance per process.
 */
const globalRegistry = globalThis as { __xeoCancelControllers?: Map<string, AbortController> };
const controllers: Map<string, AbortController> =
  globalRegistry.__xeoCancelControllers ?? (globalRegistry.__xeoCancelControllers = new Map());

/** Register the controller for a running task. Returns an unregister fn. */
export function registerRun(taskId: string, controller: AbortController): () => void {
  controllers.set(taskId, controller);
  return () => {
    // Only delete if it is still OUR controller (a restart may have replaced it).
    if (controllers.get(taskId) === controller) controllers.delete(taskId);
  };
}

/** Request cancellation. Returns true if a live run was signalled. */
export function cancelRun(taskId: string): boolean {
  const controller = controllers.get(taskId);
  if (!controller || controller.signal.aborted) return false;
  controller.abort(new Error('Run cancelled by the operator.'));
  return true;
}

export function isRunActive(taskId: string): boolean {
  const controller = controllers.get(taskId);
  return !!controller && !controller.signal.aborted;
}

/** Test helper. */
export function clearRuns(): void {
  controllers.clear();
}
