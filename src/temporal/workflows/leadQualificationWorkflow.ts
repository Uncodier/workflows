import { proxyActivities, upsertSearchAttributes } from '@temporalio/workflow';

import type { Activities } from '../activities';

export interface LeadQualificationOptions {
  site_id: string;
  userId?: string;
  daysWithoutReply?: number; // legacy, kept for compatibility
  maxLeads?: number; // legacy, total limit
  maxLeadsPerStage?: number; // default 30
  researchEnabled?: boolean;
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
  validateWorkflowConfigActivity,
  countPendingMessagesActivity,
  validateCommunicationChannelsActivity,
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

  const searchAttributes: Record<string, string[]> = {
    site_id: [site_id],
  };
  if (options.userId) {
    searchAttributes.user_id = [options.userId];
  }
  upsertSearchAttributes(searchAttributes);

  const workflowId = `lead-qualification-${site_id}`;
  const startTime = Date.now();

  const errors: string[] = [];
  let followUpWorkflowsStarted = 0;
  const results: LeadQualificationResult['results'] = [];
  let thresholdDate = '';

  // STEP 0: Validate workflow configuration
  console.log('🔐 Step 0: Validating workflow configuration...');
  const configValidation = await validateWorkflowConfigActivity(
    site_id,
    'leads_follow_up'
  );
  
  if (!configValidation.shouldExecute) {
    console.log(`⛔ Workflow execution blocked: ${configValidation.reason}`);
    
    // Log blocked execution
    await logWorkflowExecutionActivity({
      workflowId,
      workflowType: 'leadQualificationWorkflow',
      status: 'BLOCKED',
      input: options,
      error: `Workflow is ${configValidation.activityStatus} in site settings`,
    });

    return {
      success: false,
      siteId: site_id,
      qualifiedLeads: 0,
      followUpWorkflowsStarted: 0,
      thresholdDate: '',
      results: [],
      errors: [`Workflow is ${configValidation.activityStatus} in site settings`],
      executionTime: '0ms',
      completedAt: new Date().toISOString(),
    };
  }
  
  console.log(`✅ Configuration validated: ${configValidation.reason}`);

  // STEP 0.5: Validate communication channels
  console.log(`📡 Step 0.5: Validating communication channels for ${site_id}...`);
  const channelsValidation = await validateCommunicationChannelsActivity({
    site_id: site_id,
  });

  if (!channelsValidation.success) {
    const errorMsg = `Failed to validate communication channels: ${channelsValidation.error}`;
    console.error(`❌ ${errorMsg}`);
    errors.push(errorMsg);
    // Even if validation fails, we might want to continue or fail. 
    // In dailyProspection it throws if !success or returns if !hasAnyChannel.
    // We'll follow the pattern of failing if we can't validate or have no channels.
    return finalize('FAILED');
  }

  if (!channelsValidation.hasAnyChannel) {
    const errorMsg = `No communication channels (email or WhatsApp) are configured and enabled for site ${site_id}. Qualification requires at least one communication channel to send follow-up messages.`;
    console.error(`❌ ${errorMsg}`);
    errors.push(errorMsg);

    return finalize('FAILED');
  }

  console.log(`✅ Communication channels validated successfully:`);
  console.log(`   - Email channel: ${channelsValidation.hasEmailChannel ? 'Available' : 'Not configured'}`);
  console.log(`   - WhatsApp channel: ${channelsValidation.hasWhatsappChannel ? 'Available' : 'Not configured'}`);

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

  try {
    const siteResult = await getSiteActivity(site_id);
    if (!siteResult?.success || !siteResult.site?.name) {
      errors.push('Failed to get site information');
    }

    const daysWithoutReply = typeof options.daysWithoutReply === 'number' ? options.daysWithoutReply : 7;
    const maxLeads = typeof options.maxLeads === 'number' ? options.maxLeads : 100;
    const maxLeadsPerStage = typeof options.maxLeadsPerStage === 'number' ? options.maxLeadsPerStage : 30;

    const qualification = await getQualificationLeadsActivity({
      site_id,
      daysWithoutReply,
      limit: maxLeads,
      maxLeadsPerStage,
    });

    thresholdDate = qualification.thresholdDate;

    if (!qualification.success) {
      errors.push(...(qualification.errors || ['Unknown error fetching qualification leads']));
      return finalize('COMPLETED');
    }

    if (qualification.stats) {
      console.log(`📊 Selection stats:`, JSON.stringify(qualification.stats, null, 2));
    }

    const leads = qualification.leads || [];

    // Check pending messages count before queuing new follow-ups
    console.log(`🔍 Checking pending messages count for queue throttling...`);
    
    const pendingMessagesCheck = await countPendingMessagesActivity({
      site_id: site_id
    });
    
    if (!pendingMessagesCheck.success) {
      const errorMsg = `Failed to check pending messages count: ${pendingMessagesCheck.error}`;
      console.error(`❌ ${errorMsg}`);
      errors.push(errorMsg);
      // Continue with follow-up workflows despite error (don't block the workflow)
      console.log(`⚠️ Continuing with follow-up workflows despite pending messages check failure`);
    } else {
      const pendingCount = pendingMessagesCheck.count || 0;
      console.log(`📊 Pending messages count: ${pendingCount}`);
      
      if (pendingCount >= 100) {
        const throttleMsg = `Queue throttling: ${pendingCount} pending messages (>= 100) - skipping follow-up workflow queue`;
        console.log(`⏸️ ${throttleMsg}`);
        errors.push(throttleMsg);
        
        // Return early with appropriate result indicating queue is full
        return finalize('COMPLETED');
      } else {
        console.log(`✅ Pending messages count (${pendingCount}) is below threshold (100) - proceeding with follow-up workflows`);
      }
    }

    for (const lead of leads) {
      try {
        const sequence_stage = lead.sequence_stage;
        const sequence_reason = lead.sequence_reason;

        console.log(`🚀 Starting follow-up for lead ${lead.id} [Stage: ${sequence_stage || 'N/A'}]`);

        const r = await startLeadFollowUpWorkflowActivity({
          lead_id: lead.id,
          site_id,
          userId: options.userId,
          message_status: 'accepted',
          researchEnabled: options.researchEnabled ?? false,
          additionalData: {
            triggeredBy: 'leadQualificationWorkflow',
            reason: sequence_reason || 'stale_replied_lead_no_response_in_period',
            thresholdDate,
            sequence_stage,
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


