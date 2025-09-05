/**
 * Task Queue Configuration for Workflow Prioritization
 * 
 * This file defines different task queues for different priority levels.
 * Higher priority workflows get dedicated resources and faster execution.
 */

export const TASK_QUEUES = {
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
} as const;

export type TaskQueue = typeof TASK_QUEUES[keyof typeof TASK_QUEUES];

/**
 * Get the appropriate task queue based on workflow type and urgency
 */
export function getTaskQueueForWorkflow(
  workflowType: string,
  priority?: 'critical' | 'high' | 'normal' | 'low' | 'background'
): TaskQueue {
  // Always route validateEmailWorkflow to its dedicated queue regardless of overrides
  if (workflowType === 'validateEmailWorkflow') {
    return TASK_QUEUES.EMAIL_VALIDATION;
  }

  // Global override via environment variable (e.g., FORCE_TASK_QUEUE=default)
  const forcedQueue = process.env.FORCE_TASK_QUEUE;
  if (forcedQueue) {
    switch (forcedQueue) {
      case TASK_QUEUES.CRITICAL:
      case TASK_QUEUES.HIGH:
      case TASK_QUEUES.NORMAL:
      case TASK_QUEUES.LOW:
      case TASK_QUEUES.BACKGROUND:
      case TASK_QUEUES.EMAIL_VALIDATION:
        return forcedQueue as TaskQueue;
    }
    return TASK_QUEUES.NORMAL;
  }

  // Override with explicit priority if provided
  if (priority) {
    switch (priority) {
      case 'critical': return TASK_QUEUES.CRITICAL;
      case 'high': return TASK_QUEUES.HIGH;
      case 'normal': return TASK_QUEUES.NORMAL;
      case 'low': return TASK_QUEUES.LOW;
      case 'background': return TASK_QUEUES.BACKGROUND;
    }
  }

  // Auto-assign based on workflow type
  switch (workflowType) {
    // High priority workflows (moved from critical)
    case 'customerSupportMessageWorkflow':
    case 'emailCustomerSupportMessageWorkflow':
      return TASK_QUEUES.HIGH;
    
    // High priority workflows
    case 'leadAttentionWorkflow':
    case 'sendEmailFromAgentWorkflow':
    case 'sendWhatsappFromAgentWorkflow':
      return TASK_QUEUES.HIGH;
    
    // Email validation workflow (dedicated queue)
    case 'validateEmailWorkflow':
      return TASK_QUEUES.EMAIL_VALIDATION;
    
    // Normal priority workflows
    case 'dailyStandUpWorkflow':
    case 'leadGenerationWorkflow':
    case 'dailyProspectionWorkflow':
      return TASK_QUEUES.NORMAL;
    
    // Low priority workflows
    case 'buildCampaignsWorkflow':
    case 'buildContentWorkflow':
    case 'analyzeSiteWorkflow':
      return TASK_QUEUES.LOW;
    
    // Background workflows
    case 'dailyOperationsWorkflow':
    case 'scheduleActivitiesWorkflow':
    case 'syncEmailsScheduleWorkflow':
      return TASK_QUEUES.BACKGROUND;
    
    default:
      return TASK_QUEUES.NORMAL;
  }
}

/**
 * Configuration for each task queue
 */
export const TASK_QUEUE_CONFIG = {
  [TASK_QUEUES.CRITICAL]: {
    maxConcurrentActivityTaskExecutions: 50,
    maxConcurrentWorkflowTaskExecutions: 50,
    description: 'Critical workflows requiring immediate attention',
    examples: ['System Alerts', 'Emergency Escalations']
  },
  [TASK_QUEUES.HIGH]: {
    maxConcurrentActivityTaskExecutions: 30,
    maxConcurrentWorkflowTaskExecutions: 30,
    description: 'High priority workflows',
    examples: ['Customer Support', 'Lead Attention', 'Email/WhatsApp sending']
  },
  [TASK_QUEUES.NORMAL]: {
    maxConcurrentActivityTaskExecutions: 15,
    maxConcurrentWorkflowTaskExecutions: 15,
    description: 'Standard business workflows',
    examples: ['Daily operations', 'Lead generation']
  },
  [TASK_QUEUES.LOW]: {
    maxConcurrentActivityTaskExecutions: 8,
    maxConcurrentWorkflowTaskExecutions: 8,
    description: 'Lower priority batch operations',
    examples: ['Content generation', 'Campaign building']
  },
  [TASK_QUEUES.BACKGROUND]: {
    maxConcurrentActivityTaskExecutions: 5,
    maxConcurrentWorkflowTaskExecutions: 5,
    description: 'Background maintenance tasks',
    examples: ['System monitoring', 'Cleanup tasks']
  },
  [TASK_QUEUES.EMAIL_VALIDATION]: {
    maxConcurrentActivityTaskExecutions: 20,
    maxConcurrentWorkflowTaskExecutions: 20,
    description: 'Email validation workflows running on Render',
    examples: ['SMTP email validation', 'Domain verification', 'Catchall detection']
  }
} as const;
