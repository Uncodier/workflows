/**
 * Priority Workflow Executor
 * 
 * Utilities for executing workflows with different priority levels.
 * Automatically assigns the appropriate task queue based on workflow type and priority.
 */

import { getTemporalClient } from '../client';
import { getTaskQueueForWorkflow, TASK_QUEUES, type TaskQueue } from '../config/taskQueues';

export interface PriorityWorkflowOptions {
  /** Explicit priority override */
  priority?: 'critical' | 'high' | 'normal' | 'low' | 'background';
  
  /** Custom task queue (overrides automatic selection) */
  taskQueue?: TaskQueue;
  
  /** Workflow timeout */
  workflowRunTimeout?: string;
  
  /** Custom workflow ID */
  workflowId?: string;
  
  /** Additional metadata for tracking */
  metadata?: Record<string, any>;
}

/**
 * Execute a workflow with automatic priority-based task queue assignment
 */
export async function executeWorkflowWithPriority<T extends any[]>(
  workflowType: string,
  args: T,
  options: PriorityWorkflowOptions = {}
): Promise<{
  workflowId: string;
  taskQueue: TaskQueue;
  success: boolean;
  error?: string;
}> {
  try {
    const client = await getTemporalClient();
    
    // Determine task queue
    const taskQueue = workflowType === 'validateEmailWorkflow'
      ? TASK_QUEUES.EMAIL_VALIDATION // Always force validation queue for email validation
      : (options.taskQueue || getTaskQueueForWorkflow(workflowType, options.priority));
    
    // Generate workflow ID if not provided
    const workflowId = options.workflowId || 
                      `${workflowType}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // Default timeout based on priority
    const workflowRunTimeout = options.workflowRunTimeout || getDefaultTimeout(taskQueue);
    
    console.log(`🚀 Starting ${workflowType} with priority configuration:`);
    console.log(`   - Task Queue: ${taskQueue}`);
    console.log(`   - Workflow ID: ${workflowId}`);
    console.log(`   - Timeout: ${workflowRunTimeout}`);
    console.log(`   - Priority: ${options.priority || 'auto-assigned'}`);
    
    // Start workflow with priority-based configuration
    const handle = await client.workflow.start(workflowType, {
      args,
      workflowId,
      taskQueue,
      workflowRunTimeout,
    });
    
    console.log(`✅ Workflow started successfully: ${handle.workflowId}`);
    
    return {
      workflowId: handle.workflowId,
      taskQueue,
      success: true
    };
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Failed to start ${workflowType}:`, errorMessage);
    
    return {
      workflowId: options.workflowId || `failed-${Date.now()}`,
      taskQueue: options.taskQueue || TASK_QUEUES.NORMAL,
      success: false,
      error: errorMessage
    };
  }
}

/**
 * Execute a critical priority workflow (customer support, urgent issues)
 */
export async function executeCriticalWorkflow<T extends any[]>(
  workflowType: string,
  args: T,
  options: Omit<PriorityWorkflowOptions, 'priority'> = {}
): Promise<{
  workflowId: string;
  taskQueue: TaskQueue;
  success: boolean;
  error?: string;
}> {
  return executeWorkflowWithPriority(workflowType, args, {
    ...options,
    priority: 'critical'
  });
}

/**
 * Execute a high priority workflow (lead attention, communication)
 */
export async function executeHighPriorityWorkflow<T extends any[]>(
  workflowType: string,
  args: T,
  options: Omit<PriorityWorkflowOptions, 'priority'> = {}
): Promise<{
  workflowId: string;
  taskQueue: TaskQueue;
  success: boolean;
  error?: string;
}> {
  return executeWorkflowWithPriority(workflowType, args, {
    ...options,
    priority: 'high'
  });
}

/**
 * Execute a background workflow (maintenance, reports)
 */
export async function executeBackgroundWorkflow<T extends any[]>(
  workflowType: string,
  args: T,
  options: Omit<PriorityWorkflowOptions, 'priority'> = {}
): Promise<{
  workflowId: string;
  taskQueue: TaskQueue;
  success: boolean;
  error?: string;
}> {
  return executeWorkflowWithPriority(workflowType, args, {
    ...options,
    priority: 'background'
  });
}

/**
 * Get default timeout based on task queue priority
 */
function getDefaultTimeout(taskQueue: TaskQueue): string {
  switch (taskQueue) {
    case TASK_QUEUES.CRITICAL:
      return '2m';  // Critical workflows should complete quickly
    case TASK_QUEUES.HIGH:
      return '5m';  // High priority workflows
    case TASK_QUEUES.NORMAL:
      return '15m'; // Normal workflows
    case TASK_QUEUES.LOW:
      return '30m'; // Batch operations can take longer
    case TASK_QUEUES.BACKGROUND:
      return '60m'; // Background tasks have generous timeouts
    default:
      return '15m';
  }
}

/**
 * Utility to check if a workflow should be expedited based on conditions
 */
export function shouldExpediteWorkflow(
  workflowType: string,
  context: {
    isFailedRetry?: boolean;
    isCustomerFacing?: boolean;
    hoursStuck?: number;
    businessImpact?: 'high' | 'medium' | 'low';
  }
): 'critical' | 'high' | 'normal' | 'low' | 'background' {
  
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
  const defaultQueue = getTaskQueueForWorkflow(workflowType);
  
  switch (defaultQueue) {
    case TASK_QUEUES.CRITICAL: return 'critical';
    case TASK_QUEUES.HIGH: return 'high';
    case TASK_QUEUES.LOW: return 'low';
    case TASK_QUEUES.BACKGROUND: return 'background';
    default: return 'normal';
  }
}
