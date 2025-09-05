"use strict";
/**
 * Task Queue Configuration for Workflow Prioritization
 *
 * This file defines different task queues for different priority levels.
 * Higher priority workflows get dedicated resources and faster execution.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TASK_QUEUE_CONFIG = exports.TASK_QUEUES = void 0;
exports.getTaskQueueForWorkflow = getTaskQueueForWorkflow;
exports.TASK_QUEUES = {
    // Critical workflows that need immediate attention
    CRITICAL: 'critical-priority',
    // High priority workflows (customer support, urgent issues)
    HIGH: 'high-priority',
    // Normal priority workflows (daily operations)
    NORMAL: 'default',
    // Low priority workflows (reports, analytics)
    LOW: 'low-priority',
    // Background tasks (cleanup, maintenance)
    BACKGROUND: 'background-priority',
    // Email validation queue (dedicated for Render deployment)
    EMAIL_VALIDATION: 'validation'
};
/**
 * Get the appropriate task queue based on workflow type and urgency
 */
function getTaskQueueForWorkflow(workflowType, priority) {
    // Always route validateEmailWorkflow to its dedicated queue regardless of overrides
    if (workflowType === 'validateEmailWorkflow') {
        return exports.TASK_QUEUES.EMAIL_VALIDATION;
    }
    // Global override via environment variable (e.g., FORCE_TASK_QUEUE=default)
    const forcedQueue = process.env.FORCE_TASK_QUEUE;
    if (forcedQueue) {
        switch (forcedQueue) {
            case exports.TASK_QUEUES.CRITICAL:
            case exports.TASK_QUEUES.HIGH:
            case exports.TASK_QUEUES.NORMAL:
            case exports.TASK_QUEUES.LOW:
            case exports.TASK_QUEUES.BACKGROUND:
            case exports.TASK_QUEUES.EMAIL_VALIDATION:
                return forcedQueue;
        }
        return exports.TASK_QUEUES.NORMAL;
    }
    // Override with explicit priority if provided
    if (priority) {
        switch (priority) {
            case 'critical': return exports.TASK_QUEUES.CRITICAL;
            case 'high': return exports.TASK_QUEUES.HIGH;
            case 'normal': return exports.TASK_QUEUES.NORMAL;
            case 'low': return exports.TASK_QUEUES.LOW;
            case 'background': return exports.TASK_QUEUES.BACKGROUND;
        }
    }
    // Auto-assign based on workflow type
    switch (workflowType) {
        // High priority workflows (moved from critical)
        case 'customerSupportMessageWorkflow':
        case 'emailCustomerSupportMessageWorkflow':
            return exports.TASK_QUEUES.HIGH;
        // High priority workflows
        case 'leadAttentionWorkflow':
        case 'sendEmailFromAgentWorkflow':
        case 'sendWhatsappFromAgentWorkflow':
            return exports.TASK_QUEUES.HIGH;
        // Email validation workflow (dedicated queue)
        case 'validateEmailWorkflow':
            return exports.TASK_QUEUES.EMAIL_VALIDATION;
        // Normal priority workflows
        case 'dailyStandUpWorkflow':
        case 'leadGenerationWorkflow':
        case 'dailyProspectionWorkflow':
            return exports.TASK_QUEUES.NORMAL;
        // Low priority workflows
        case 'buildCampaignsWorkflow':
        case 'buildContentWorkflow':
        case 'analyzeSiteWorkflow':
            return exports.TASK_QUEUES.LOW;
        // Background workflows
        case 'dailyOperationsWorkflow':
        case 'scheduleActivitiesWorkflow':
        case 'syncEmailsScheduleWorkflow':
            return exports.TASK_QUEUES.BACKGROUND;
        default:
            return exports.TASK_QUEUES.NORMAL;
    }
}
/**
 * Configuration for each task queue
 */
exports.TASK_QUEUE_CONFIG = {
    [exports.TASK_QUEUES.CRITICAL]: {
        maxConcurrentActivityTaskExecutions: 50,
        maxConcurrentWorkflowTaskExecutions: 50,
        description: 'Critical workflows requiring immediate attention',
        examples: ['System Alerts', 'Emergency Escalations']
    },
    [exports.TASK_QUEUES.HIGH]: {
        maxConcurrentActivityTaskExecutions: 30,
        maxConcurrentWorkflowTaskExecutions: 30,
        description: 'High priority workflows',
        examples: ['Customer Support', 'Lead Attention', 'Email/WhatsApp sending']
    },
    [exports.TASK_QUEUES.NORMAL]: {
        maxConcurrentActivityTaskExecutions: 15,
        maxConcurrentWorkflowTaskExecutions: 15,
        description: 'Standard business workflows',
        examples: ['Daily operations', 'Lead generation']
    },
    [exports.TASK_QUEUES.LOW]: {
        maxConcurrentActivityTaskExecutions: 8,
        maxConcurrentWorkflowTaskExecutions: 8,
        description: 'Lower priority batch operations',
        examples: ['Content generation', 'Campaign building']
    },
    [exports.TASK_QUEUES.BACKGROUND]: {
        maxConcurrentActivityTaskExecutions: 5,
        maxConcurrentWorkflowTaskExecutions: 5,
        description: 'Background maintenance tasks',
        examples: ['System monitoring', 'Cleanup tasks']
    },
    [exports.TASK_QUEUES.EMAIL_VALIDATION]: {
        maxConcurrentActivityTaskExecutions: 20,
        maxConcurrentWorkflowTaskExecutions: 20,
        description: 'Email validation workflows running on Render',
        examples: ['SMTP email validation', 'Domain verification', 'Catchall detection']
    }
};
