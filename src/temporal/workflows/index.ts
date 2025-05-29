import { dataProcessingWorkflow } from './dataProcessingWorkflow';
import { scheduledApiPollingWorkflow } from './cronWorkflow';
import { syncEmailsWorkflow } from './syncEmailsWorkflow';
import { syncEmailsScheduleWorkflow } from './syncEmailsScheduleWorkflow';
import { scheduleActivitiesWorkflow } from './scheduleActivitiesWorkflow';
import { activityPrioritizationEngineWorkflow } from './activityPrioritizationEngineWorkflow';
import { sendReportWorkflow } from './sendReportWorkflow';

// Export workflows individually
export * from './dataProcessingWorkflow';
export * from './cronWorkflow';
export * from './syncEmailsWorkflow';
export * from './syncEmailsScheduleWorkflow';
export * from './scheduleActivitiesWorkflow';
export * from './activityPrioritizationEngineWorkflow';
export * from './sendReportWorkflow';

// Also export as a bundle for the client
export const workflows = {
  dataProcessingWorkflow,
  scheduledApiPollingWorkflow,
  syncEmailsWorkflow,
  syncEmailsScheduleWorkflow,
  scheduleActivitiesWorkflow,
  activityPrioritizationEngineWorkflow,
  sendReportWorkflow,
};

// Workflow types for type-safe execution
export type WorkflowType = keyof typeof workflows; 