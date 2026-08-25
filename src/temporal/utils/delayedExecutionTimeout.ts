const HOUR_MS = 60 * 60 * 1000;
const MIN_HOURS = 48;
const MAX_HOURS = 168; // 7 days
const BUFFER_HOURS = 2;

/**
 * Run timeout for delayedExecutionWorkflow: delay + buffer, clamped to 48h–7d.
 * Timers scheduled more than 48h ahead (e.g. weekend → Monday 09:00) were
 * dying at the previous hard-coded 48h limit.
 */
export function computeDelayedWorkflowRunTimeout(delayMs: number): string {
  const safeDelayMs = Number.isFinite(delayMs) ? Math.max(delayMs, 0) : 0;
  const hours = Math.ceil(safeDelayMs / HOUR_MS) + BUFFER_HOURS;
  const bounded = Math.min(Math.max(hours, MIN_HOURS), MAX_HOURS);
  return `${bounded}h`;
}
