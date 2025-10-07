import { proxyActivities } from '@temporalio/workflow';

import type { Activities } from '../activities';

export interface LeadQualificationOptions {
  site_id: string;
  userId?: string;
  daysWithoutReply?: number; // default 7
  maxLeads?: number; // default 30
  additionalData?: any;
}

export interface LeadQualificationResult {
  success: boolean;
  siteId: string;
  qualifiedLeads: number;
  followUpWorkflowsStarted: number;
  thresholdDate: string;
  results: Array<{ lead_id: string; success: boolean; workflowId?: string; error?: string }>;
  errors: string[];
  executionTime: string;
  completedAt: string;
}

const {
  logWorkflowExecutionActivity,
  saveCronStatusActivity,
  getSiteActivity,
  startLeadFollowUpWorkflowActivity,
  getQualificationLeadsActivity,
} = proxyActivities<Activities>({
  startToCloseTimeout: '5 minutes',
  retry: {
    initialInterval: '3s',
    backoffCoefficient: 2,
    maximumAttempts: 3,
  },
});

export async function leadQualificationWorkflow(
  options: LeadQualificationOptions
): Promise<LeadQualificationResult> {
  const { site_id } = options;
  if (!site_id) throw new Error('site_id is required');

  const workflowId = `lead-qualification-${site_id}`;
  const startTime = Date.now();

  await logWorkflowExecutionActivity({
    workflowId,
    workflowType: 'leadQualificationWorkflow',
    status: 'STARTED',
    input: options,
  });

  await saveCronStatusActivity({
    siteId: site_id,
    workflowId,
    scheduleId: workflowId,
    activityName: 'leadQualificationWorkflow',
    status: 'RUNNING',
    lastRun: new Date().toISOString(),
  });

  const errors: string[] = [];
  let followUpWorkflowsStarted = 0;
  const results: LeadQualificationResult['results'] = [];
  let thresholdDate = '';

  try {
    const siteResult = await getSiteActivity(site_id);
    if (!siteResult?.success || !siteResult.site?.name) {
      errors.push('Failed to get site information');
    }

    const daysWithoutReply = typeof options.daysWithoutReply === 'number' ? options.daysWithoutReply : 7;
    const maxLeads = typeof options.maxLeads === 'number' ? options.maxLeads : 30;

    const qualification = await getQualificationLeadsActivity({
      site_id,
      daysWithoutReply,
      limit: maxLeads,
    });

    thresholdDate = qualification.thresholdDate;

    if (!qualification.success) {
      errors.push(...(qualification.errors || ['Unknown error fetching qualification leads']));
      return finalize('COMPLETED');
    }

    const leads = qualification.leads || [];

    for (const lead of leads) {
      try {
        const r = await startLeadFollowUpWorkflowActivity({
          lead_id: lead.id,
          site_id,
          userId: options.userId,
          additionalData: {
            triggeredBy: 'leadQualificationWorkflow',
            reason: 'stale_replied_lead_no_response_in_period',
            thresholdDate,
            ...options.additionalData,
          },
        });

        if (r.success) {
          followUpWorkflowsStarted++;
          results.push({ lead_id: lead.id, success: true, workflowId: r.workflowId });
        } else {
          results.push({ lead_id: lead.id, success: false, error: r.error });
          if (r.error) errors.push(`Lead ${lead.id}: ${r.error}`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        results.push({ lead_id: lead.id, success: false, error: msg });
        errors.push(`Lead ${lead.id}: ${msg}`);
      }
    }

    return finalize('COMPLETED');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    errors.push(msg);
    await saveCronStatusActivity({
      siteId: site_id,
      workflowId,
      scheduleId: workflowId,
      activityName: 'leadQualificationWorkflow',
      status: 'FAILED',
      lastRun: new Date().toISOString(),
      errorMessage: msg,
    });
    await logWorkflowExecutionActivity({
      workflowId,
      workflowType: 'leadQualificationWorkflow',
      status: 'FAILED',
      input: options,
    });
    return buildResult();
  }

  function buildResult(): LeadQualificationResult {
    return {
      success: errors.length === 0,
      siteId: site_id,
      qualifiedLeads: results.length,
      followUpWorkflowsStarted,
      thresholdDate,
      results,
      errors,
      executionTime: `${((Date.now() - startTime) / 1000).toFixed(2)}s`,
      completedAt: new Date().toISOString(),
    };
  }

  async function finalize(status: 'COMPLETED' | 'FAILED'): Promise<LeadQualificationResult> {
    await saveCronStatusActivity({
      siteId: site_id,
      workflowId,
      scheduleId: workflowId,
      activityName: 'leadQualificationWorkflow',
      status,
      lastRun: new Date().toISOString(),
    });

    await logWorkflowExecutionActivity({
      workflowId,
      workflowType: 'leadQualificationWorkflow',
      status,
      input: options,
    });

    return buildResult();
  }
}


