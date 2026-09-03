"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DAILY_WORKFLOW_REUSE_POLICY = void 0;
exports.generateDailyWorkflowId = generateDailyWorkflowId;
const common_1 = require("@temporalio/common");
function generateDailyWorkflowId(options) {
    const { workflowType, siteId, dateStr, timeStr, isTimer } = options;
    // Normalize time string to remove colons if present
    const normalizedTime = timeStr ? timeStr.replace(/:/g, '') : '';
    // Clean up workflowType by removing 'Workflow' suffix if we want, or just use as is.
    // We'll use it as is for simplicity, but maybe drop "Workflow" if present?
    // Actually, the original code used things like "daily-standup-timer-siteId-2026-08-31-0900"
    // Let's match whatever prefix is passed.
    const timerInfix = isTimer ? '-timer' : '';
    if (normalizedTime) {
        return `${workflowType}${timerInfix}-${siteId}-${dateStr}-${normalizedTime}`;
    }
    return `${workflowType}${timerInfix}-${siteId}-${dateStr}`;
}
/**
 * Common reuse policy for daily workflows that ensures we don't run
 * duplicate successful workflows for the same site and date.
 */
exports.DAILY_WORKFLOW_REUSE_POLICY = common_1.WorkflowIdReusePolicy.ALLOW_DUPLICATE_FAILED_ONLY;
