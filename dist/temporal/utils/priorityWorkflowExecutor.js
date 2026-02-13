"use strict";
/**
 * Priority Workflow Executor
 *
 * Utilities for executing workflows with different priority levels.
 * Automatically assigns the appropriate task queue based on workflow type and priority.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.executeWorkflowWithPriority = executeWorkflowWithPriority;
exports.executeCriticalWorkflow = executeCriticalWorkflow;
exports.executeHighPriorityWorkflow = executeHighPriorityWorkflow;
exports.executeBackgroundWorkflow = executeBackgroundWorkflow;
exports.shouldExpediteWorkflow = shouldExpediteWorkflow;
const client_1 = require("../client");
const taskQueues_1 = require("../config/taskQueues");
const searchAttributes_1 = require("./searchAttributes");
/**
 * Execute a workflow with automatic priority-based task queue assignment
 */
async function executeWorkflowWithPriority(workflowType, args, options = {}) {
    try {
        const client = await (0, client_1.getTemporalClient)();
        // Determine task queue
        const taskQueue = workflowType === 'validateEmailWorkflow'
            ? taskQueues_1.TASK_QUEUES.EMAIL_VALIDATION // Always force validation queue for email validation
            : (options.taskQueue || (0, taskQueues_1.getTaskQueueForWorkflow)(workflowType, options.priority));
        // Generate workflow ID if not provided
        const workflowId = options.workflowId ||
            `${workflowType}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        // Default timeout based on priority
        const workflowRunTimeout = options.workflowRunTimeout || getDefaultTimeout(taskQueue);
        // Auto-extract search attributes from first argument if it's an object
        let searchAttributes = {};
        if (options.autoExtractSearchAttributes !== false && args[0] && typeof args[0] === 'object') {
            const extracted = (0, searchAttributes_1.extractSearchAttributesFromInput)(args[0]);
            searchAttributes = extracted;
        }
        // Merge with manually provided search attributes (manual takes precedence)
        if (options.searchAttributes) {
            searchAttributes = (0, searchAttributes_1.mergeSearchAttributes)(searchAttributes, options.searchAttributes);
        }
        console.log(`🚀 Starting ${workflowType} with priority configuration:`);
        console.log(`   - Task Queue: ${taskQueue}`);
        console.log(`   - Workflow ID: ${workflowId}`);
        console.log(`   - Timeout: ${workflowRunTimeout}`);
        console.log(`   - Priority: ${options.priority || 'auto-assigned'}`);
        if (Object.keys(searchAttributes).length > 0) {
            console.log(`   - Search Attributes:`, searchAttributes);
        }
        // Start workflow with priority-based configuration
        const handle = await client.workflow.start(workflowType, {
            args,
            workflowId,
            taskQueue,
            workflowRunTimeout,
            // Only add searchAttributes if we have any
            ...(Object.keys(searchAttributes).length > 0 && { searchAttributes })
        });
        console.log(`✅ Workflow started successfully: ${handle.workflowId}`);
        return {
            workflowId: handle.workflowId,
            taskQueue,
            success: true
        };
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`❌ Failed to start ${workflowType}:`, errorMessage);
        return {
            workflowId: options.workflowId || `failed-${Date.now()}`,
            taskQueue: options.taskQueue || taskQueues_1.TASK_QUEUES.NORMAL,
            success: false,
            error: errorMessage
        };
    }
}
/**
 * Execute a critical priority workflow (customer support, urgent issues)
 */
async function executeCriticalWorkflow(workflowType, args, options = {}) {
    return executeWorkflowWithPriority(workflowType, args, {
        ...options,
        priority: 'critical'
    });
}
/**
 * Execute a high priority workflow (lead attention, communication)
 */
async function executeHighPriorityWorkflow(workflowType, args, options = {}) {
    return executeWorkflowWithPriority(workflowType, args, {
        ...options,
        priority: 'high'
    });
}
/**
 * Execute a background workflow (maintenance, reports)
 */
async function executeBackgroundWorkflow(workflowType, args, options = {}) {
    return executeWorkflowWithPriority(workflowType, args, {
        ...options,
        priority: 'background'
    });
}
/**
 * Get default timeout based on task queue priority
 */
function getDefaultTimeout(taskQueue) {
    switch (taskQueue) {
        case taskQueues_1.TASK_QUEUES.CRITICAL:
            return '2m'; // Critical workflows should complete quickly
        case taskQueues_1.TASK_QUEUES.HIGH:
            return '5m'; // High priority workflows
        case taskQueues_1.TASK_QUEUES.NORMAL:
            return '15m'; // Normal workflows
        case taskQueues_1.TASK_QUEUES.LOW:
            return '30m'; // Batch operations can take longer
        case taskQueues_1.TASK_QUEUES.BACKGROUND:
            return '60m'; // Background tasks have generous timeouts
        default:
            return '15m';
    }
}
/**
 * Utility to check if a workflow should be expedited based on conditions
 */
function shouldExpediteWorkflow(workflowType, context) {
    // Critical conditions
    if (context.isFailedRetry && context.isCustomerFacing) {
        return 'critical';
    }
    if (context.hoursStuck && context.hoursStuck > 24) {
        return 'critical';
    }
    if (context.businessImpact === 'high') {
        return 'critical';
    }
    // High priority conditions
    if (context.isCustomerFacing) {
        return 'high';
    }
    if (context.isFailedRetry) {
        return 'high';
    }
    if (context.hoursStuck && context.hoursStuck > 6) {
        return 'high';
    }
    // Use default priority for workflow type
    const defaultQueue = (0, taskQueues_1.getTaskQueueForWorkflow)(workflowType);
    switch (defaultQueue) {
        case taskQueues_1.TASK_QUEUES.CRITICAL: return 'critical';
        case taskQueues_1.TASK_QUEUES.HIGH: return 'high';
        case taskQueues_1.TASK_QUEUES.LOW: return 'low';
        case taskQueues_1.TASK_QUEUES.BACKGROUND: return 'background';
        default: return 'normal';
    }
}
