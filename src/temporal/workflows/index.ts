import { dataProcessingWorkflow } from './dataProcessingWorkflow';
import { scheduledApiPollingWorkflow } from './cronWorkflow';
import { syncEmailsWorkflow } from './syncEmailsWorkflow';
import { syncEmailsScheduleWorkflow } from './syncEmailsScheduleWorkflow';
import { scheduleActivitiesWorkflow } from './scheduleActivitiesWorkflow';
import { activityPrioritizationEngineWorkflow } from './activityPrioritizationEngineWorkflow';
import { sendReportWorkflow } from './sendReportWorkflow';
import { scheduleCustomerSupportMessagesWorkflow, customerSupportMessageWorkflow } from './scheduleCustomerSupportMessagesWorkflow';
import { sendEmailFromAgent } from './sendEmailFromAgentWorkflow';

// Export workflows individually
export * from './dataProcessingWorkflow';
export * from './cronWorkflow';
export * from './syncEmailsWorkflow';
export * from './syncEmailsScheduleWorkflow';
export * from './scheduleActivitiesWorkflow';
export * from './activityPrioritizationEngineWorkflow';
export * from './sendReportWorkflow';
export * from './scheduleCustomerSupportMessagesWorkflow';
export * from './sendEmailFromAgentWorkflow';

// Also export as a bundle for the client
export const workflows = {
  dataProcessingWorkflow,
  scheduledApiPollingWorkflow,
  syncEmailsWorkflow,
  syncEmailsScheduleWorkflow,
  scheduleActivitiesWorkflow,
  activityPrioritizationEngineWorkflow,
  sendReportWorkflow,
  scheduleCustomerSupportMessagesWorkflow,
  customerSupportMessageWorkflow,
  sendEmailFromAgent,
};

// Workflow names for Temporal Client (strings)
export const workflowNames = {
  dataProcessingWorkflow: 'dataProcessingWorkflow',
  scheduledApiPollingWorkflow: 'scheduledApiPollingWorkflow', 
  syncEmailsWorkflow: 'syncEmailsWorkflow',
  syncEmailsScheduleWorkflow: 'syncEmailsScheduleWorkflow',
  scheduleActivitiesWorkflow: 'scheduleActivitiesWorkflow',
  activityPrioritizationEngineWorkflow: 'activityPrioritizationEngineWorkflow',
  sendReportWorkflow: 'sendReportWorkflow',
  scheduleCustomerSupportMessagesWorkflow: 'scheduleCustomerSupportMessagesWorkflow',
  customerSupportMessageWorkflow: 'customerSupportMessageWorkflow',
  sendEmailFromAgent: 'sendEmailFromAgent',
};

// Workflow types for type-safe execution
export type WorkflowType = keyof typeof workflows; 