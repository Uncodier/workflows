/**
 * Priority Workflow Examples
 * 
 * Examples showing how to execute workflows with different priority levels
 * in your Temporal workflow system.
 */

import { 
  executeCriticalWorkflow, 
  executeHighPriorityWorkflow, 
  executeBackgroundWorkflow,
  executeWorkflowWithPriority,
  shouldExpediteWorkflow
} from '../src/temporal/utils/priorityWorkflowExecutor';
import type { EmailData } from '../src/temporal/activities/customerSupportActivities';
import type { WhatsAppMessageData } from '../src/temporal/activities/whatsappActivities';

/**
 * Example 1: High Priority Customer Support Workflow
 * This should run with high priority (moved from critical)
 */
export async function executeHighPriorityCustomerSupport(emailData: EmailData) {
  console.log('⚡ Executing HIGH PRIORITY customer support workflow...');
  
  const result = await executeHighPriorityWorkflow(
    'customerSupportMessageWorkflow',
    [emailData, { origin: 'email', agentId: 'support-agent-1' }],
    {
      workflowRunTimeout: '5m', // High priority workflows
      metadata: {
        urgency: 'high',
        source: 'customer_support',
        priority: 'high'
      }
    }
  );
  
  if (result.success) {
    console.log(`✅ High priority customer support started: ${result.workflowId}`);
    console.log(`🏃‍♂️ Running on: ${result.taskQueue}`);
  } else {
    console.error(`❌ Failed to start high priority workflow: ${result.error}`);
  }
  
  return result;
}

/**
 * Example 2: High Priority Lead Attention
 * Important but not critical - should run soon
 */
export async function executeUrgentLeadAttention(leadData: {
  lead_id: string;
  user_message: string;
  system_message: string;
}) {
  console.log('⚡ Executing HIGH priority lead attention workflow...');
  
  const result = await executeHighPriorityWorkflow(
    'leadAttentionWorkflow',
    [leadData],
    {
      workflowRunTimeout: '5m',
      metadata: {
        priority: 'high',
        leadValue: 'enterprise',
        responseTime: 'urgent'
      }
    }
  );
  
  return result;
}

/**
 * Example 3: Smart Priority Assignment
 * Automatically determines priority based on context
 */
export async function executeSmartPriorityWorkflow(
  workflowType: string,
  args: any[],
  context: {
    isRetry?: boolean;
    failureCount?: number;
    customerTier?: 'enterprise' | 'business' | 'personal';
    lastExecutionHours?: number;
  }
) {
  // Determine priority based on context
  const priority = shouldExpediteWorkflow(workflowType, {
    isFailedRetry: context.isRetry && (context.failureCount || 0) > 1,
    isCustomerFacing: ['customerSupportMessageWorkflow', 'sendEmailFromAgentWorkflow'].includes(workflowType),
    hoursStuck: context.lastExecutionHours,
    businessImpact: context.customerTier === 'enterprise' ? 'high' : 'medium'
  });
  
  console.log(`🧠 Smart priority assignment: ${priority} for ${workflowType}`);
  
  const result = await executeWorkflowWithPriority(workflowType, args, { priority });
  
  return result;
}

/**
 * Example 4: Batch Background Processing
 * Low priority operations that can run when resources are available
 */
export async function executeBackgroundBatch(sites: Array<{ id: string; name: string }>) {
  console.log('🔄 Executing background batch workflows...');
  
  const results = [];
  
  for (const site of sites) {
    const result = await executeBackgroundWorkflow(
      'analyzeSiteWorkflow',
      [{ siteId: site.id, analysis_type: 'weekly_report' }],
      {
        workflowRunTimeout: '60m', // Background tasks can take longer
        workflowId: `analyze-site-${site.id}-${Date.now()}`,
        metadata: {
          priority: 'background',
          batchProcessing: true,
          siteName: site.name
        }
      }
    );
    
    results.push(result);
    
    // Small delay between background workflows to avoid overwhelming the system
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  console.log(`📊 Started ${results.length} background analysis workflows`);
  return results;
}

/**
 * Example 5: Failed Workflow Retry with Escalated Priority
 * When a workflow fails, retry it with higher priority
 */
export async function retryFailedWorkflowWithPriority(
  originalWorkflowType: string,
  originalArgs: any[],
  failureDetails: {
    originalWorkflowId: string;
    failureCount: number;
    lastError: string;
    hoursStuck: number;
  }
) {
  console.log(`🔄 Retrying failed workflow with escalated priority...`);
  console.log(`   Original: ${failureDetails.originalWorkflowId}`);
  console.log(`   Failures: ${failureDetails.failureCount}`);
  console.log(`   Stuck for: ${failureDetails.hoursStuck}h`);
  
  // Escalate priority based on failure count and time stuck
  let priority: 'critical' | 'high' | 'normal';
  
  if (failureDetails.hoursStuck > 24 || failureDetails.failureCount > 3) {
    priority = 'critical';
  } else if (failureDetails.hoursStuck > 6 || failureDetails.failureCount > 1) {
    priority = 'high';
  } else {
    priority = 'normal';
  }
  
  console.log(`📈 Escalated priority: ${priority}`);
  
  const result = await executeWorkflowWithPriority(
    originalWorkflowType,
    originalArgs,
    {
      priority,
      workflowId: `retry-${failureDetails.originalWorkflowId}-${Date.now()}`,
      metadata: {
        isRetry: true,
        originalWorkflowId: failureDetails.originalWorkflowId,
        failureCount: failureDetails.failureCount,
        escalatedPriority: priority,
        retryReason: 'automatic_escalation'
      }
    }
  );
  
  return result;
}

/**
 * Example 6: Emergency Customer Support (Highest Priority)
 * For customer complaints or urgent issues that need immediate attention
 */
export async function executeEmergencyCustomerSupport(
  messageData: EmailData | { whatsappData: WhatsAppMessageData },
  urgencyReason: string
) {
  console.log('🚨🚨 EMERGENCY customer support workflow!');
  console.log(`🔥 Reason: ${urgencyReason}`);
  
  const result = await executeCriticalWorkflow(
    'customerSupportMessageWorkflow',
    [messageData, { 
      origin: 'whatsappData' in messageData ? 'whatsapp' : 'email',
      agentId: 'emergency-support'
    }],
    {
      workflowRunTimeout: '1m', // Emergency workflows must complete in 1 minute
      workflowId: `emergency-support-${Date.now()}`,
      metadata: {
        urgency: 'emergency',
        reason: urgencyReason,
        escalationLevel: 'critical',
        requiresImmedateAttention: true
      }
    }
  );
  
  if (result.success) {
    console.log(`🏃‍♂️💨 Emergency support started: ${result.workflowId}`);
    console.log(`⚡ Running on critical queue: ${result.taskQueue}`);
  }
  
  return result;
}

/**
 * Example 7: Mixed Priority Batch Operations
 * Process multiple workflows with different priorities in optimal order
 */
export async function executeMixedPriorityBatch(workflows: Array<{
  type: string;
  args: any[];
  priority?: 'critical' | 'high' | 'normal' | 'low' | 'background';
  metadata?: Record<string, any>;
}>) {
  console.log(`📋 Processing ${workflows.length} workflows with mixed priorities...`);
  
  // Sort by priority (critical first, background last)
  const priorityOrder = ['critical', 'high', 'normal', 'low', 'background'];
  const sortedWorkflows = workflows.sort((a, b) => {
    const aPriority = priorityOrder.indexOf(a.priority || 'normal');
    const bPriority = priorityOrder.indexOf(b.priority || 'normal');
    return aPriority - bPriority;
  });
  
  const results = [];
  
  for (const workflow of sortedWorkflows) {
    console.log(`🚀 Starting ${workflow.type} with ${workflow.priority || 'normal'} priority`);
    
    const result = await executeWorkflowWithPriority(
      workflow.type,
      workflow.args,
      {
        priority: workflow.priority,
        metadata: workflow.metadata
      }
    );
    
    results.push(result);
    
    // Longer delay for lower priority workflows
    const delayMs = workflow.priority === 'background' ? 2000 :
                   workflow.priority === 'low' ? 1000 :
                   workflow.priority === 'normal' ? 500 : 0;
    
    if (delayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  
  const summary = results.reduce((acc, result) => {
    const status = result.success ? 'successful' : 'failed';
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  
  console.log(`✅ Batch complete: ${summary.successful || 0} successful, ${summary.failed || 0} failed`);
  
  return results;
}
