import { proxyActivities, workflowInfo } from '@temporalio/workflow';
import type { Activities } from '../activities';

const { dispatchIcpMiningActivity } = proxyActivities<Activities>({
  startToCloseTimeout: '4 minutes', retry: { maximumAttempts: 3 },
});

/** Admission only: independent native schedule every five minutes, never daily reports. */
export async function icpDispatcherWorkflow() {
  return dispatchIcpMiningActivity({ dispatchId: workflowInfo().workflowId });
}