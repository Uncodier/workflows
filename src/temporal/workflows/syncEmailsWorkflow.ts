import { proxyActivities } from '@temporalio/workflow';
import type { Activities } from '../activities';

// Define the activity interface and options
const { 
  logWorkflowExecutionActivity,
} = proxyActivities<Activities>({
  startToCloseTimeout: '1 minute',
  retry: {
    maximumAttempts: 3,
  },
});

export interface SyncEmailsOptions {
  userId: string;
  provider: 'gmail' | 'outlook' | 'imap';
  since?: Date;
  folderIds?: string[];
  batchSize?: number;
}

/**
 * Workflow to synchronize emails from various providers
 * 
 * @param options - Configuration options for email synchronization
 */
export async function syncEmailsWorkflow(
  options: SyncEmailsOptions
): Promise<any> {
  // Log workflow execution start
  await logWorkflowExecutionActivity({
    workflowId: `sync-emails-${options.userId}`,
    workflowType: 'syncEmailsWorkflow',
    status: 'STARTED',
    input: options,
  });

  try {
    // TODO: Implement email sync logic with activities
    const result = {
      success: true,
      syncedEmails: 0,
      errors: [],
    };

    // Log successful completion
    await logWorkflowExecutionActivity({
      workflowId: `sync-emails-${options.userId}`,
      workflowType: 'syncEmailsWorkflow',
      status: 'COMPLETED',
      input: options,
      output: result,
    });

    return result;
  } catch (error: unknown) {
    // Log workflow execution failure
    await logWorkflowExecutionActivity({
      workflowId: `sync-emails-${options.userId}`,
      workflowType: 'syncEmailsWorkflow',
      status: 'FAILED',
      input: options,
      error: error instanceof Error ? error.message : String(error),
    });

    throw error;
  }
} 