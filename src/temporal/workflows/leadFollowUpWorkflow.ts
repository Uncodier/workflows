import { proxyActivities, sleep, startChild, patched, deprecatePatch, ParentClosePolicy } from '@temporalio/workflow';
import type { Activities } from '../activities';
import { leadResearchWorkflow, type LeadResearchOptions, type LeadResearchResult } from './leadResearchWorkflow';
import { leadInvalidationWorkflow, type LeadInvalidationOptions } from './leadInvalidationWorkflow';
import { leadCompanyResearchWorkflow, type LeadCompanyResearchOptions, type LeadCompanyResearchResult } from './leadCompanyResearchWorkflow';
import { sendWhatsappFromAgent } from './sendWhatsappFromAgentWorkflow';

// Define the activity interface and options
const { 
  logWorkflowExecutionActivity,
  saveCronStatusActivity,
  getSiteActivity,
  getLeadActivity,
  leadFollowUpActivity,
  saveLeadFollowUpLogsActivity,
  sendEmailFromAgentActivity,
  updateConversationStatusAfterFollowUpActivity,
  validateMessageAndConversationActivity,
  updateMessageStatusToSentActivity,
  updateTaskStatusToCompletedActivity,
  cleanupFailedFollowUpActivity,
  updateMessageTimestampActivity,
  validateContactInformation,
  invalidateEmailOnlyActivity,
  validateCommunicationChannelsActivity,
  checkMessageStatusActivity,
} = proxyActivities<Activities>({
  startToCloseTimeout: '5 minutes', // Reasonable timeout for lead follow-up
  retry: {
    maximumAttempts: 3,
  },
});

/**
 * Sanitize phone numbers without inferring/adding country codes.
 * Let Twilio/backend resolve the region/country.
 */
function formatPhoneNumber(phone: string): string {
  if (!phone || typeof phone !== 'string') {
    return phone;
  }

  // Keep digits and plus signs only; collapse to a single leading +
  let cleanPhone = phone.replace(/[^\d+]/g, '');

  if (cleanPhone.startsWith('+')) {
    cleanPhone = '+' + cleanPhone.slice(1).replace(/\+/g, '');
  } else {
    cleanPhone = cleanPhone.replace(/\+/g, '');
  }

  return cleanPhone;
}

export interface LeadFollowUpOptions {
  lead_id: string;                    // Required: Lead ID
  site_id: string;                    // Required: Site ID
  userId?: string;
  additionalData?: any;
}

export interface LeadFollowUpResult {
  success: boolean;
  leadId: string;
  siteId: string;
  siteName?: string;
  siteUrl?: string;
  followUpActions?: any[];
  nextSteps?: string[];
  data?: any;
  messageSent?: {
    channel: 'email' | 'whatsapp';
    recipient: string;
    success: boolean;
    messageId?: string;
  };
  errors: string[];
  executionTime: string;
  completedAt: string;
}

/**
 * Verifica si un lead necesita investigación antes del follow-up
 * Un lead necesita investigación si:
 * 1. Es de origen 'lead_generation_workflow'
 * 2. No tiene notas o las notas están vacías
 * 3. No tiene metadata o la metadata está vacía
 */
function shouldExecuteLeadResearch(leadInfo: any): boolean {
  // Verificar si es de origen lead_generation_workflow
  if (leadInfo.origin !== 'lead_generation_workflow') {
    console.log(`📋 Lead origin is '${leadInfo.origin}', not 'lead_generation_workflow' - skipping research`);
    return false;
  }

  // Verificar si tiene notas
  const hasNotes = leadInfo.notes && typeof leadInfo.notes === 'string' && leadInfo.notes.trim() !== '';
  
  // Verificar si tiene metadata
  const hasMetadata = leadInfo.metadata && 
                     typeof leadInfo.metadata === 'object' && 
                     Object.keys(leadInfo.metadata).length > 0;

  console.log(`📋 Lead research check for lead ${leadInfo.id}:`);
  console.log(`   - Origin: ${leadInfo.origin}`);
  console.log(`   - Has notes: ${hasNotes} (${leadInfo.notes ? `"${leadInfo.notes.substring(0, 50)}..."` : 'null/empty'})`);
  console.log(`   - Has metadata: ${hasMetadata} (${hasMetadata ? Object.keys(leadInfo.metadata).length : 0} keys)`);

  // Si no tiene notas NI metadata, necesita investigación
  const needsResearch = !hasNotes && !hasMetadata;
  
  if (needsResearch) {
    console.log(`✅ Lead ${leadInfo.id} needs research - missing both notes and metadata`);
  } else {
    console.log(`❌ Lead ${leadInfo.id} does not need research - has ${hasNotes ? 'notes' : ''}${hasNotes && hasMetadata ? ' and ' : ''}${hasMetadata ? 'metadata' : ''}`);
  }

  return needsResearch;
}

/**
 * Checks if lead needs company website research
 * Criteria: No notes AND has website/domain
 */
function shouldExecuteCompanyResearch(leadInfo: any): boolean {
  const hasNotes = leadInfo.notes && typeof leadInfo.notes === 'string' && leadInfo.notes.trim() !== '';
  
  if (hasNotes) {
    console.log(`📋 Lead has notes - skipping company research`);
    return false;
  }
  
  const website = extractWebsite(leadInfo);
  
  if (!website) {
    console.log(`📋 No website found - skipping company research`);
    return false;
  }
  
  console.log(`✅ Lead needs company research - no notes but has website: ${website}`);
  return true;
}

/**
 * Extracts website URL from lead info
 */
function extractWebsite(leadInfo: any): string | null {
  // Check lead.website
  if (leadInfo.website && typeof leadInfo.website === 'string' && leadInfo.website.trim() !== '') {
    return leadInfo.website.trim();
  }
  
  // Check lead.company.website
  if (leadInfo.company && typeof leadInfo.company === 'object' && leadInfo.company.website) {
    return leadInfo.company.website.trim();
  }
  
  // Check lead.metadata.website
  if (leadInfo.metadata && leadInfo.metadata.website) {
    return leadInfo.metadata.website.trim();
  }
  
  return null;
}

/**
 * Workflow to execute lead follow-up
 * 
 * This workflow:
 * 1. Gets site information by siteId to obtain site details
 * 2. Executes lead follow-up using the sales agent API
 * 3. Saves the follow-up data/logs to the database
 * 4. Sends follow-up message via email or WhatsApp based on the communication channel
 * 
 * @param options - Configuration options for lead follow-up
 */
export async function leadFollowUpWorkflow(
  options: LeadFollowUpOptions
): Promise<LeadFollowUpResult> {
  const { lead_id, site_id } = options;
  
  if (!lead_id) {
    throw new Error('No lead ID provided');
  }
  
  if (!site_id) {
    throw new Error('No site ID provided');
  }
  
  const workflowId = `lead-follow-up-${lead_id}-${site_id}`;
  const startTime = Date.now();
  
  console.log(`📞 Starting lead follow-up workflow for lead ${lead_id} on site ${site_id}`);
  console.log(`📋 Workflow version: v0.2.1 - Email deliverable validation + parse fix`);
  console.log(`📋 Options:`, JSON.stringify(options, null, 2));

  // Log workflow execution start
  await logWorkflowExecutionActivity({
    workflowId,
    workflowType: 'leadFollowUpWorkflow',
    status: 'STARTED',
    input: options,
  });

  // Update cron status to indicate the workflow is running
  await saveCronStatusActivity({
    siteId: site_id,
    workflowId,
    scheduleId: `lead-follow-up-${lead_id}-${site_id}`,
    activityName: 'leadFollowUpWorkflow',
    status: 'RUNNING',
    lastRun: new Date().toISOString()
  });

  const errors: string[] = [];
  let followUpActions: any[] = [];
  let nextSteps: string[] = [];
  let siteName = '';
  let siteUrl = '';
  let response: any = null;
  let messageSent: { channel: 'email' | 'whatsapp'; recipient: string; success: boolean; messageId?: string } | undefined;
  let emailInvalidatedInEarlyValidation = false; // Track if email was invalidated during early validation

  try {
    console.log(`🏢 Step 1: Getting site information for ${site_id}...`);
    
    // Get site information to obtain site details
    const siteResult = await getSiteActivity(site_id);
    
    if (!siteResult.success) {
      const errorMsg = `Failed to get site information: ${siteResult.error}`;
      console.error(`❌ ${errorMsg}`);
      errors.push(errorMsg);
      throw new Error(errorMsg);
    }
    
    const site = siteResult.site!;
    siteName = site.name;
    siteUrl = site.url;
    
    console.log(`✅ Retrieved site information: ${siteName} (${siteUrl})`);

    // Use versioning to handle the non-deterministic change
    // TODO: Remove this patch after all existing workflows complete (estimated: 30 days after deployment)
    const shouldGetLeadInfo = patched('add-lead-info-check-v1');
    
    // Deprecate the patch after some time to encourage cleanup
    deprecatePatch('add-lead-info-check-v1');
    
    let leadInfo: any = null;
    
    if (shouldGetLeadInfo) {
      console.log(`👤 Step 2: Getting lead information and checking if research is needed...`);
      
      // Get lead information from database to check origin, notes, and metadata
      const leadResult = await getLeadActivity(lead_id);
      
      if (!leadResult.success) {
        const errorMsg = `Failed to get lead information: ${leadResult.error}`;
        console.error(`❌ ${errorMsg}`);
        errors.push(errorMsg);
        throw new Error(errorMsg);
      }
      
      leadInfo = leadResult.lead!;
      
      console.log(`✅ Retrieved lead information: ${leadInfo.name || leadInfo.email}`);
      console.log(`📋 Lead details:`);
      console.log(`   - Name: ${leadInfo.name || 'N/A'}`);
      console.log(`   - Email: ${leadInfo.email || 'N/A'}`);
      console.log(`   - Origin: ${leadInfo.origin || 'N/A'}`);
      console.log(`   - Has notes: ${leadInfo.notes ? 'Yes' : 'No'}`);
      console.log(`   - Has metadata: ${leadInfo.metadata && Object.keys(leadInfo.metadata).length > 0 ? 'Yes' : 'No'}`);

    console.log(`🔍 Step 2.1: Early validation of contact information before research to save resources...`);
    
    // Extract contact information for early validation
    const leadEmail = leadInfo.email;
    const leadPhone = leadInfo.phone || leadInfo.phone_number;
    
    console.log(`📋 Contact info for early validation:`);
    console.log(`   - Email: ${leadEmail || 'undefined'}`);
    console.log(`   - Phone: ${leadPhone || 'undefined'}`);
    
    // Only proceed if we have at least one valid contact method
    if (!leadEmail && !leadPhone) {
      console.log(`🚫 No contact information available (no email and no phone) - skipping research and follow-up`);
      
      const executionTime = `${((Date.now() - startTime) / 1000).toFixed(2)}s`;
      const result: LeadFollowUpResult = {
        success: false,
        leadId: lead_id,
        siteId: site_id,
        siteName,
        siteUrl,
        followUpActions: [],
        nextSteps: [],
        data: null,
        messageSent: undefined,
        errors: ['No contact information available - lead has no email and no phone'],
        executionTime,
        completedAt: new Date().toISOString()
      };

      // Update cron status
      await saveCronStatusActivity({
        siteId: site_id,
        workflowId,
        scheduleId: `lead-follow-up-${lead_id}-${site_id}`,
        activityName: 'leadFollowUpWorkflow',
        status: 'COMPLETED',
        lastRun: new Date().toISOString()
      });

      // Log completion
      await logWorkflowExecutionActivity({
        workflowId,
        workflowType: 'leadFollowUpWorkflow',
        status: 'COMPLETED',
        input: options,
        output: result,
      });

      return result;
    }
    
    // Perform early contact validation (without messages, just contact info)
    const earlyValidationResult = await validateContactInformation({
      email: leadEmail,
      hasEmailMessage: true, // Assume we will have messages for now
      hasWhatsAppMessage: true, // Assume we will have messages for now
      leadId: lead_id,
      phone: leadPhone,
      leadMetadata: leadInfo.metadata // Pass lead metadata to check emailVerified flag
    });
    
    console.log(`📊 Early validation completed: type=${earlyValidationResult.validationType}, shouldProceed=${earlyValidationResult.shouldProceed}`);
    console.log(`📋 Reason: ${earlyValidationResult.reason}`);
    console.log(`📊 Full validation result:`, JSON.stringify(earlyValidationResult, null, 2));
    
    // Handle specific early validation results that require immediate action
    if (earlyValidationResult.validationType === 'email' && !earlyValidationResult.isValid && earlyValidationResult.success) {
      console.log(`🚫 Email validation failed in early validation (invalid or not deliverable)`);
      console.log(`📧 Email value: ${leadEmail || 'null/undefined'}`);
      console.log(`📋 Reason: ${earlyValidationResult.reason}`);
      
      const hasLeadWhatsApp = leadPhone && leadPhone.trim() !== '';
      
      // Check if site has WhatsApp configured
      console.log(`🔍 Checking if site has WhatsApp channel configured...`);
      const channelsValidation = await validateCommunicationChannelsActivity({
        site_id: site_id
      });
      
      const hasSiteWhatsApp = channelsValidation.success && channelsValidation.hasWhatsappChannel;
      console.log(`📊 Channel validation results:`);
      console.log(`   - Lead has WhatsApp: ${hasLeadWhatsApp ? '✅' : '❌'}`);
      console.log(`   - Site has WhatsApp configured: ${hasSiteWhatsApp ? '✅' : '❌'}`);
      
      // Use full invalidation workflow if:
      // a) Site doesn't have WhatsApp configured (even if lead has phone)
      // b) Lead doesn't have WhatsApp phone number
      const shouldUseFullInvalidation = !hasSiteWhatsApp || !hasLeadWhatsApp;
      
      if (shouldUseFullInvalidation) {
        // Use full invalidation workflow - either site has no WhatsApp or lead has no phone
        const reason = !hasSiteWhatsApp ? 'Site has no WhatsApp configured' : 'Lead has no WhatsApp phone number';
        console.log(`🚫 ${reason} - using full lead invalidation workflow and stopping before research...`);
        
        const invalidationOptions: LeadInvalidationOptions = {
          lead_id: lead_id,
          site_id: site_id,
          reason: 'invalid_email', // This covers both invalid and non-deliverable emails
          email: leadEmail,
          userId: options.userId || site.user_id
        };
        
        const invalidationHandle = await startChild(leadInvalidationWorkflow, {
          args: [invalidationOptions],
          workflowId: `lead-invalidation-${lead_id}-email-early-${Date.now()}`,
          parentClosePolicy: ParentClosePolicy.PARENT_CLOSE_POLICY_ABANDON // ✅ Child continues independently
        });
        
        console.log(`🚀 Lead invalidation workflow started (early validation), waiting for completion...`);
        
        try {
          const invalidationResult = await invalidationHandle.result();
          
          if (invalidationResult.success) {
            console.log(`✅ Lead invalidation completed successfully (early validation)`);
          } else {
            console.error(`⚠️ Lead invalidation failed (early validation): ${invalidationResult.errors.join(', ')}`);
            errors.push(`Lead invalidation failed: ${invalidationResult.errors.join(', ')}`);
          }
        } catch (invalidationError) {
          const invalidationErrorMessage = invalidationError instanceof Error ? invalidationError.message : String(invalidationError);
          console.error(`⚠️ Exception during lead invalidation (early validation): ${invalidationErrorMessage}`);
          errors.push(`Lead invalidation exception: ${invalidationErrorMessage}`);
        }
        
        // Complete the workflow successfully after invalidation since there's no valid communication channel
        const executionTime = `${((Date.now() - startTime) / 1000).toFixed(2)}s`;
        const result: LeadFollowUpResult = {
          success: true, // Changed to true since invalidation completed successfully
          leadId: lead_id,
          siteId: site_id,
          siteName,
          siteUrl,
          followUpActions: [],
          nextSteps: [],
          data: null,
          messageSent: undefined,
          errors: [...errors, 'Lead invalidated due to invalid/non-deliverable email and no WhatsApp available (early validation)'],
          executionTime,
          completedAt: new Date().toISOString()
        };

        // Update cron status
        await saveCronStatusActivity({
          siteId: site_id,
          workflowId,
          scheduleId: `lead-follow-up-${lead_id}-${site_id}`,
          activityName: 'leadFollowUpWorkflow',
          status: 'COMPLETED',
          lastRun: new Date().toISOString()
        });

        // Log completion
        await logWorkflowExecutionActivity({
          workflowId,
          workflowType: 'leadFollowUpWorkflow',
          status: 'COMPLETED',
          input: options,
          output: result,
        });

        return result;
      } else {
        // Both lead and site have WhatsApp available, handle email invalidation appropriately
        console.log(`📱✅ Both lead and site have WhatsApp available - invalidating only email but continuing with WhatsApp workflow`);
        
        if (leadEmail) {
          // Email exists but is invalid or not deliverable, invalidate it
          console.log(`📧🚫 Email invalid or not deliverable but WhatsApp available - invalidating only email field...`);
          
          const emailInvalidationResult = await invalidateEmailOnlyActivity({
            lead_id: lead_id,
            failed_email: leadEmail,
            userId: options.userId || site.user_id
          });
          
          if (emailInvalidationResult.success) {
            console.log(`✅ Email invalidated successfully (early validation), site_id preserved for WhatsApp communication`);
            emailInvalidatedInEarlyValidation = true; // Mark email as invalidated to prevent sending later
          } else {
            console.error(`❌ Failed to invalidate email (early validation): ${emailInvalidationResult.error}`);
            errors.push(`Email invalidation failed: ${emailInvalidationResult.error}`);
          }
        } else {
          // No email exists, but we have WhatsApp, so just mark as no email
          console.log(`📧🚫 No email exists but WhatsApp available - marking as no email for later processing`);
          emailInvalidatedInEarlyValidation = true; // Mark as no email to prevent email sending later
        }
        
        // Note: We don't return here - let the shouldProceed logic below handle the flow
        console.log(`📋 Email invalidation completed, proceeding to shouldProceed check...`);
      }
    }
    
    // If API worked but we shouldn't proceed, complete successfully after invalidation
    if (!earlyValidationResult.shouldProceed) {
      console.log(`✅ Contact validation API worked but email is invalid or not deliverable - completing workflow after successful invalidation`);
      console.log(`📋 Validation details:`);
      console.log(`   - Type: ${earlyValidationResult.validationType}`);
      console.log(`   - Valid: ${earlyValidationResult.isValid}`);
      console.log(`   - Reason: ${earlyValidationResult.reason}`);
      console.log(`   - Email: ${leadEmail || 'undefined'}`);
      console.log(`   - Phone: ${leadPhone || 'undefined'}`);
      
      // Create appropriate message for successful validation but invalid contact
      const validationMessage = `Contact validation completed: ${earlyValidationResult.reason}`;
      
      // Complete workflow successfully since validation API worked correctly
      const executionTime = `${((Date.now() - startTime) / 1000).toFixed(2)}s`;
      
      console.log(`🎉 Lead follow-up workflow completed successfully after contact validation (invalid/non-deliverable email, no alternative contact)`);
      console.log(`📊 Summary: Lead ${lead_id} validation completed for ${siteName} in ${executionTime}`);

      // Update cron status to indicate successful completion
      await saveCronStatusActivity({
        siteId: site_id,
        workflowId,
        scheduleId: `lead-follow-up-${lead_id}-${site_id}`,
        activityName: 'leadFollowUpWorkflow',
        status: 'COMPLETED',
        lastRun: new Date().toISOString()
      });

      // Log successful completion
      await logWorkflowExecutionActivity({
        workflowId,
        workflowType: 'leadFollowUpWorkflow',
        status: 'COMPLETED',
        input: options,
        output: {
          success: true,
          leadId: lead_id,
          siteId: site_id,
          siteName,
          siteUrl,
          followUpActions: [],
          nextSteps: [],
          data: null,
          messageSent: undefined,
          errors: [validationMessage],
          executionTime,
          completedAt: new Date().toISOString()
        },
      });

      // Return success result since validation worked correctly
      return {
        success: true,
        leadId: lead_id,
        siteId: site_id,
        siteName,
        siteUrl,
        followUpActions: [],
        nextSteps: [],
        data: null,
        messageSent: undefined,
        errors: [validationMessage],
        executionTime,
        completedAt: new Date().toISOString()
      };
    }
    
    // Check if the validation API itself failed (not just invalid email)
    if (!earlyValidationResult.success) {
      console.log(`❌ Contact validation API failed - failing workflow`);
      console.log(`🔍 API failure details:`);
      console.log(`   - Error: ${earlyValidationResult.error}`);
      console.log(`   - Reason: ${earlyValidationResult.reason}`);
      
      // Create appropriate error message for API failure
      const apiFailureError = `Contact validation API failed: ${earlyValidationResult.error || earlyValidationResult.reason}`;
      errors.push(apiFailureError);

      // Update cron status to indicate API failure
      await saveCronStatusActivity({
        siteId: site_id,
        workflowId,
        scheduleId: `lead-follow-up-${lead_id}-${site_id}`,
        activityName: 'leadFollowUpWorkflow',
        status: 'FAILED',
        lastRun: new Date().toISOString(),
        errorMessage: apiFailureError
      });

      // Log workflow failure due to API failure
      await logWorkflowExecutionActivity({
        workflowId,
        workflowType: 'leadFollowUpWorkflow',
        status: 'FAILED',
        input: options,
        error: apiFailureError,
      });

      // Throw error to properly fail the workflow when API fails
      throw new Error(apiFailureError);
    }
    
    console.log(`✅ Early contact validation passed - proceeding with research and follow-up`);

    // Check if lead needs research before follow-up (now that we know contact is valid)
      if (shouldExecuteLeadResearch(leadInfo)) {
        console.log(`🔍 Step 2.2: Executing lead research after contact validation...`);
        
        try {
          const leadResearchOptions: LeadResearchOptions = {
            lead_id: lead_id,
            site_id: site_id,
            userId: options.userId || site.user_id,
            additionalData: {
              ...options.additionalData,
              executedBeforeFollowUp: true,
              followUpWorkflowId: workflowId,
              researchReason: 'missing_notes_and_metadata',
              originalLeadInfo: leadInfo
            }
          };
          
          console.log(`🚀 Starting lead research workflow as child process...`);
          
          const leadResearchHandle = await startChild(leadResearchWorkflow, {
            args: [leadResearchOptions],
            workflowId: `lead-research-followup-${lead_id}-${site_id}-${Date.now()}`,
          });
          
          const leadResearchResult: LeadResearchResult = await leadResearchHandle.result();
          
          if (leadResearchResult.success) {
            console.log(`✅ Lead research completed successfully before follow-up`);
            console.log(`📊 Research results:`);
            console.log(`   - Lead information enriched: Yes`);
            console.log(`   - Deep research executed: ${leadResearchResult.deepResearchResult ? 'Yes' : 'No'}`);
            console.log(`   - Lead segmentation executed: ${leadResearchResult.leadSegmentationResult ? 'Yes' : 'No'}`);
            console.log(`   - Execution time: ${leadResearchResult.executionTime}`);
          } else {
            console.error(`⚠️ Lead research failed, but continuing with follow-up: ${leadResearchResult.errors.join(', ')}`);
            errors.push(`Lead research failed: ${leadResearchResult.errors.join(', ')}`);
          }
          
        } catch (researchError) {
          const errorMessage = researchError instanceof Error ? researchError.message : String(researchError);
          console.error(`⚠️ Exception during lead research, but continuing with follow-up: ${errorMessage}`);
          errors.push(`Lead research exception: ${errorMessage}`);
        }
      } else {
        console.log(`⏭️ Skipping lead research - lead does not meet criteria`);
      }
      
      // Check if lead needs company website research (lighter alternative)
      if (!shouldExecuteLeadResearch(leadInfo) && shouldExecuteCompanyResearch(leadInfo)) {
        console.log(`🌐 Step 2.3: Executing company website research...`);
        
        const website = extractWebsite(leadInfo);
        
        try {
          const companyResearchOptions: LeadCompanyResearchOptions = {
            lead_id: lead_id,
            site_id: site_id,
            website: website!,
            userId: options.userId || site.user_id,
            additionalData: {
              ...options.additionalData,
              executedBeforeFollowUp: true,
              followUpWorkflowId: workflowId
            }
          };
          
          console.log(`🚀 Starting company website research workflow as child process...`);
          
          const companyResearchHandle = await startChild(leadCompanyResearchWorkflow, {
            args: [companyResearchOptions],
            workflowId: `lead-company-research-${lead_id}-${Date.now()}`,
            parentClosePolicy: ParentClosePolicy.PARENT_CLOSE_POLICY_ABANDON
          });
          
          const companyResearchResult: LeadCompanyResearchResult = await companyResearchHandle.result();
          
          if (companyResearchResult.success) {
            console.log(`✅ Company research completed successfully`);
            console.log(`📊 Research results:`);
            console.log(`   - Website analyzed: ${companyResearchResult.website}`);
            console.log(`   - Company info extracted: ${companyResearchResult.companyInfo ? 'Yes' : 'No'}`);
            console.log(`   - Execution time: ${companyResearchResult.executionTime}`);
          } else {
            console.error(`⚠️ Company research failed, but continuing with follow-up: ${companyResearchResult.errors.join(', ')}`);
            errors.push(`Company research failed: ${companyResearchResult.errors.join(', ')}`);
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          console.error(`⚠️ Exception during company research, but continuing with follow-up: ${errorMessage}`);
          errors.push(`Company research exception: ${errorMessage}`);
        }
      } else {
        console.log(`⏭️ Skipping company research - lead does not meet criteria (either has notes or no website)`);
      }
    } else {
      console.log(`⚠️ Running legacy path (v0) - skipping lead info check and research due to workflow versioning`);
      console.log(`   This is expected for workflows that started before the lead info check feature was added`);
    }

    console.log(`📞 Step 3: Executing lead follow-up for lead ${lead_id}...`);
    
    // Prepare lead follow-up request
    const followUpRequest = {
      lead_id: lead_id,
      site_id: site_id,
      userId: options.userId || site.user_id,
      additionalData: options.additionalData
    };
    
    console.log(`🔧 Lead follow-up configuration:`);
    console.log(`   - Lead ID: ${followUpRequest.lead_id}`);
    console.log(`   - Site ID: ${followUpRequest.site_id}`);
    console.log(`   - User ID: ${followUpRequest.userId}`);
    
    // Execute lead follow-up
    const followUpResult = await leadFollowUpActivity(followUpRequest);
    
    if (!followUpResult.success) {
      const errorMsg = `Failed to execute lead follow-up: ${followUpResult.error}`;
      console.error(`❌ ${errorMsg}`);
      errors.push(errorMsg);
      
      // Check if this is a NO_VALID_CHANNELS error that should fail the workflow
      let isNoValidChannelsError = false;
      try {
        // Parse the error to check for NO_VALID_CHANNELS code
        const errorObj = typeof followUpResult.error === 'string' ? 
          JSON.parse(followUpResult.error) : followUpResult.error;
        
        if (errorObj && errorObj.code === 'NO_VALID_CHANNELS') {
          isNoValidChannelsError = true;
          console.log(`🚫 NO_VALID_CHANNELS error detected - this is a business logic failure, not a retryable error`);
        }
      } catch (parseError) {
        // If we can't parse the error, check if the string contains the error code
        if (typeof followUpResult.error === 'string' && 
            followUpResult.error.includes('NO_VALID_CHANNELS')) {
          isNoValidChannelsError = true;
          console.log(`🚫 NO_VALID_CHANNELS error detected in error string - this is a business logic failure`);
        }
      }
      
      // For NO_VALID_CHANNELS errors, update status to FAILED before throwing
      if (isNoValidChannelsError) {
        console.log(`📊 Updating cron status to FAILED for NO_VALID_CHANNELS error...`);
        
        // Update cron status to indicate failure
        await saveCronStatusActivity({
          siteId: site_id,
          workflowId,
          scheduleId: `lead-follow-up-${lead_id}-${site_id}`,
          activityName: 'leadFollowUpWorkflow',
          status: 'FAILED',
          lastRun: new Date().toISOString(),
          errorMessage: errorMsg
        });

        // Log workflow execution failure
        await logWorkflowExecutionActivity({
          workflowId,
          workflowType: 'leadFollowUpWorkflow',
          status: 'FAILED',
          input: options,
          error: errorMsg,
        });
        
        console.log(`✅ Cron status and workflow logs updated to FAILED for NO_VALID_CHANNELS error`);
      }
      
      throw new Error(errorMsg);
    }
    
    followUpActions = followUpResult.followUpActions || [];
    nextSteps = followUpResult.nextSteps || [];
    response = followUpResult.data;
    
    console.log(`✅ Successfully executed lead follow-up for lead ${lead_id}`);
    console.log(`📊 Results: ${followUpActions.length} follow-up actions, ${nextSteps.length} next steps`);
    
    if (followUpActions.length > 0) {
      console.log(`📋 Follow-up actions:`);
      followUpActions.forEach((action, index) => {
        console.log(`   ${index + 1}. ${action.title || action.name || action.type || `Action ${index + 1}`}`);
      });
    }
    
    if (nextSteps.length > 0) {
      console.log(`🎯 Next steps:`);
      nextSteps.forEach((step, index) => {
        console.log(`   ${index + 1}. ${step}`);
      });
    }

    // Early validation: Check if messages are available for sending
    const messages = response?.data?.messages || response?.messages || {};
    const lead = response?.data?.lead || response?.lead || {};
    const emailMessage = messages.email?.message;
    const whatsappMessage = messages.whatsapp?.message;
    
    if (!emailMessage && !whatsappMessage) {
      console.log(`⚠️ No follow-up messages found in response - skipping message sending workflow`);
      console.log(`📝 Available data: lead=${!!lead}, messages=${!!messages}, emailMsg=${!!emailMessage}, whatsappMsg=${!!whatsappMessage}`);
      
      // Save logs without message sending
      if (response) {
        console.log(`📝 Step 4: Saving lead follow-up logs to database...`);
        
        const saveLogsResult = await saveLeadFollowUpLogsActivity({
          siteId: site_id,
          leadId: lead_id,
          userId: options.userId || site.user_id,
          data: response
        });
        
        if (!saveLogsResult.success) {
          const errorMsg = `Failed to save lead follow-up logs: ${saveLogsResult.error}`;
          console.error(`⚠️ ${errorMsg}`);
          errors.push(errorMsg);
        } else {
          console.log(`✅ Lead follow-up logs saved successfully`);
        }
      }

      // Complete workflow without sending messages
      const executionTime = `${((Date.now() - startTime) / 1000).toFixed(2)}s`;
      const result: LeadFollowUpResult = {
        success: true,
        leadId: lead_id,
        siteId: site_id,
        siteName,
        siteUrl,
        followUpActions,
        nextSteps,
        data: response,
        messageSent: undefined, // No message was sent
        errors: [...errors, 'No follow-up messages available for sending'],
        executionTime,
        completedAt: new Date().toISOString()
      };

      console.log(`🎉 Lead follow-up workflow completed (no messages to send)!`);
      console.log(`📊 Summary: Lead ${lead_id} follow-up completed for ${siteName} in ${executionTime}`);
      console.log(`⚠️ No follow-up messages were sent - no content available`);

      // Update cron status to indicate successful completion
      await saveCronStatusActivity({
        siteId: site_id,
        workflowId,
        scheduleId: `lead-follow-up-${lead_id}-${site_id}`,
        activityName: 'leadFollowUpWorkflow',
        status: 'COMPLETED',
        lastRun: new Date().toISOString()
      });

      // Log successful completion
      await logWorkflowExecutionActivity({
        workflowId,
        workflowType: 'leadFollowUpWorkflow',
        status: 'COMPLETED',
        input: options,
        output: result,
      });

      return result;
    }

    console.log(`✅ Follow-up messages found - proceeding with validation and message sending workflow`);
    console.log(`📧 Email message: ${!!emailMessage}, 📱 WhatsApp message: ${!!whatsappMessage}`);

    // Step 4: Extract message information from follow-up response (contact already validated early)
    console.log(`🔍 Step 4: Extracting message information from follow-up response...`);
    
    const validationMessages = response?.data?.messages || response?.messages || {};
    const validationLead = response?.data?.lead || response?.lead || {};
    const validationEmail = validationLead.email || validationLead.contact_email;
    const validationPhone = validationLead.phone || validationLead.phone_number;
    const validationEmailMessage = validationMessages.email?.message;
    const validationWhatsappMessage = validationMessages.whatsapp?.message;
    
    // Debug: Log what we're extracting from the response
    console.log(`📋 Extracted data from follow-up response:`);
    console.log(`   - Email: ${validationEmail || 'undefined'}`);
    console.log(`   - Phone: ${validationPhone || 'undefined'}`);
    console.log(`   - Has email message: ${!!validationEmailMessage}`);
    console.log(`   - Has WhatsApp message: ${!!validationWhatsappMessage}`);
    console.log(`   - Response structure: data=${!!response?.data}, messages=${!!validationMessages}, lead=${!!validationLead}`);
    
    // Note: Contact validation was already performed in Step 2.1 (early validation)
    // Here we just need to verify we have the right message channels based on early validation results
    console.log(`✅ Contact was already validated in Step 2.1 - proceeding with message preparation`);

    // Step 4.5: Save lead follow-up logs to database
    let logsResult: any = null;
    if (response) {
      console.log(`📝 Step 4.5: Saving lead follow-up logs to database...`);
      
      logsResult = await saveLeadFollowUpLogsActivity({
        siteId: site_id,
        leadId: lead_id,
        userId: options.userId || site.user_id,
        data: response
      });
      
      if (!logsResult.success) {
        const errorMsg = `Failed to save lead follow-up logs: ${logsResult.error}`;
        console.error(`⚠️ ${errorMsg}`);
        errors.push(errorMsg);
        // Note: We don't throw here as the main operation was successful
      } else {
        console.log(`✅ Lead follow-up logs saved successfully`);
        
        // Verify that logs returned the required message and conversation IDs
        if (!logsResult.message_ids || logsResult.message_ids.length === 0) {
          const errorMsg = `Logs endpoint did not return message IDs - cannot proceed with follow-up delivery`;
          console.error(`❌ ${errorMsg}`);
          errors.push(errorMsg);
          throw new Error(errorMsg);
        }
        
        console.log(`📋 Logs returned required IDs for follow-up delivery:`);
        console.log(`   - Message IDs: ${logsResult.message_ids.join(', ')}`);
        console.log(`   - Conversation IDs: ${logsResult.conversation_ids?.join(', ') || 'None'}`);
        console.log(`✅ Proceeding with 2-hour timer and message delivery`);
      }
    }

    // Note: We trust the logs endpoint - if it returns message_ids, we proceed with delivery

    // Step 5: Wait 2 hours first, then check message status
    if (response && (response.data?.messages || response.messages) && (response.data?.lead || response.lead)) {
      const primaryMessageId = logsResult?.message_ids?.[0];
      
      // Step 5.1: Wait 2 hours first (as per original flow)
      console.log(`⏰ Step 5: Waiting 2 hours before checking message status...`);
      await sleep('2 hours');
      
      // Step 5.2: After 2 hours, check message status
      if (!primaryMessageId) {
        console.log(`⚠️ No message ID available from logs - proceeding with validation and sending`);
      } else {
        console.log(`🔍 Step 5.2: Checking message status after 2-hour wait...`);
        console.log(`📝 Message ID: ${primaryMessageId}`);
        
        // Check message status after 2-hour wait
        const statusCheck = await checkMessageStatusActivity({
          message_id: primaryMessageId,
          site_id: site_id
        });
        
        if (!statusCheck.success) {
          console.error(`❌ Failed to check message status: ${statusCheck.error}`);
          errors.push(`Failed to check message status: ${statusCheck.error}`);
          // Continue with sending as fallback
        } else if (!statusCheck.message_exists) {
          console.log(`⚠️ Message ${primaryMessageId} does not exist - message was deleted, cancelling delivery`);
          errors.push('Message was deleted from database - delivery cancelled');
          
          // Execute cleanup since message was deleted
          console.log(`🧹 Message was deleted - executing cleanup...`);
          
          try {
            const cleanupResult = await cleanupFailedFollowUpActivity({
              lead_id: lead_id,
              site_id: site_id,
              conversation_id: logsResult?.conversation_ids?.[0],
              message_id: primaryMessageId,
              failure_reason: 'message_deleted_by_user_before_delivery',
              delivery_channel: undefined
            });
            
            if (cleanupResult.success) {
              console.log(`✅ Cleanup completed after message deletion`);
            } else {
              console.error(`⚠️ Cleanup failed: ${cleanupResult.error}`);
              errors.push(`Cleanup failed: ${cleanupResult.error}`);
            }
          } catch (cleanupError) {
            const cleanupErrorMessage = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
            console.error(`⚠️ Exception during cleanup: ${cleanupErrorMessage}`);
            errors.push(`Cleanup exception: ${cleanupErrorMessage}`);
          }
          
          // Complete workflow without sending
          const executionTime = `${((Date.now() - startTime) / 1000).toFixed(2)}s`;
          const result: LeadFollowUpResult = {
            success: true,
            leadId: lead_id,
            siteId: site_id,
            siteName,
            siteUrl,
            followUpActions,
            nextSteps,
            data: response,
            messageSent: undefined,
            errors: errors,
            executionTime,
            completedAt: new Date().toISOString()
          };

          await saveCronStatusActivity({
            siteId: site_id,
            workflowId,
            scheduleId: `lead-follow-up-${lead_id}-${site_id}`,
            activityName: 'leadFollowUpWorkflow',
            status: 'COMPLETED',
            lastRun: new Date().toISOString()
          });

          await logWorkflowExecutionActivity({
            workflowId,
            workflowType: 'leadFollowUpWorkflow',
            status: 'COMPLETED',
            input: options,
            output: result,
          });

          return result;
        } else {
          const currentStatus = statusCheck.status;
          console.log(`📊 Message status after 2-hour wait: ${currentStatus || 'undefined'}`);
          
          // If status is still pending, poll every hour until it becomes accepted
          if (currentStatus === 'pending') {
            console.log(`⏳ Message is still pending after 2 hours - polling every 1 hour until status changes to accepted...`);
            
            const maxPollingHours = 336; // Maximum 2 weeks (14 days * 24 hours) of polling
            let pollingHours = 0;
            let messageStatus: string | undefined = currentStatus;
            
            while (messageStatus === 'pending' && pollingHours < maxPollingHours) {
              console.log(`⏰ Waiting 1 hour before next status check... (${pollingHours + 1}/${maxPollingHours} hours)`);
              await sleep('1 hour');
              pollingHours++;
              
              console.log(`🔍 Checking message status (check #${pollingHours})...`);
              const nextStatusCheck = await checkMessageStatusActivity({
                message_id: primaryMessageId,
                site_id: site_id
              });
              
              if (!nextStatusCheck.success) {
                console.error(`❌ Failed to check message status: ${nextStatusCheck.error}`);
                errors.push(`Failed to check message status during polling: ${nextStatusCheck.error}`);
                // Continue polling despite error
                continue;
              }
              
              if (!nextStatusCheck.message_exists) {
                console.log(`⚠️ Message ${primaryMessageId} no longer exists - stopping polling`);
                messageStatus = undefined;
                break;
              }
              
              messageStatus = nextStatusCheck.status;
              console.log(`📊 Message status after ${pollingHours} hour(s) of polling: ${messageStatus || 'undefined'}`);
              
              if (messageStatus === 'accepted') {
                console.log(`✅ Message status changed to accepted after ${pollingHours} hour(s) of polling - proceeding with sending`);
                break;
              } else if (messageStatus === 'sent' || messageStatus === 'failed') {
                console.log(`⚠️ Message status is already '${messageStatus}' - skipping send`);
                // Complete workflow without sending
                const executionTime = `${((Date.now() - startTime) / 1000).toFixed(2)}s`;
                const result: LeadFollowUpResult = {
                  success: true,
                  leadId: lead_id,
                  siteId: site_id,
                  siteName,
                  siteUrl,
                  followUpActions,
                  nextSteps,
                  data: response,
                  messageSent: undefined,
                  errors: [...errors, `Message status is '${messageStatus}' - already processed`],
                  executionTime,
                  completedAt: new Date().toISOString()
                };

                await saveCronStatusActivity({
                  siteId: site_id,
                  workflowId,
                  scheduleId: `lead-follow-up-${lead_id}-${site_id}`,
                  activityName: 'leadFollowUpWorkflow',
                  status: 'COMPLETED',
                  lastRun: new Date().toISOString()
                });

                await logWorkflowExecutionActivity({
                  workflowId,
                  workflowType: 'leadFollowUpWorkflow',
                  status: 'COMPLETED',
                  input: options,
                  output: result,
                });

                return result;
              }
            }
            
            if (messageStatus === 'pending' && pollingHours >= maxPollingHours) {
              console.log(`⏰ Maximum polling time (${maxPollingHours} hours / 2 weeks) reached - message still pending, cancelling workflow`);
              errors.push(`Message remained pending after ${maxPollingHours} hours (2 weeks) of polling - workflow cancelled`);
              
              // Execute cleanup since timeout was reached
              console.log(`🧹 Polling timeout reached - executing cleanup (delete message and conversation if only message)...`);
              
              try {
                const cleanupResult = await cleanupFailedFollowUpActivity({
                  lead_id: lead_id,
                  site_id: site_id,
                  conversation_id: logsResult?.conversation_ids?.[0],
                  message_id: primaryMessageId,
                  failure_reason: 'message_timeout_after_polling_period',
                  delivery_channel: undefined
                });
                
                if (cleanupResult.success) {
                  console.log(`✅ Cleanup completed after polling timeout:`);
                  console.log(`   - Message deleted: ${cleanupResult.message_deleted}`);
                  console.log(`   - Conversation deleted: ${cleanupResult.conversation_deleted}`);
                  console.log(`   - Messages remaining in conversation: ${cleanupResult.cleanup_summary?.messages_in_conversation || 0}`);
                } else {
                  console.error(`⚠️ Cleanup failed: ${cleanupResult.error}`);
                  errors.push(`Cleanup failed: ${cleanupResult.error}`);
                }
              } catch (cleanupError) {
                const cleanupErrorMessage = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
                console.error(`⚠️ Exception during cleanup: ${cleanupErrorMessage}`);
                errors.push(`Cleanup exception: ${cleanupErrorMessage}`);
              }
              
              // Complete workflow without sending
              const executionTime = `${((Date.now() - startTime) / 1000).toFixed(2)}s`;
              const result: LeadFollowUpResult = {
                success: true,
                leadId: lead_id,
                siteId: site_id,
                siteName,
                siteUrl,
                followUpActions,
                nextSteps,
                data: response,
                messageSent: undefined,
                errors: errors,
                executionTime,
                completedAt: new Date().toISOString()
              };

              await saveCronStatusActivity({
                siteId: site_id,
                workflowId,
                scheduleId: `lead-follow-up-${lead_id}-${site_id}`,
                activityName: 'leadFollowUpWorkflow',
                status: 'COMPLETED',
                lastRun: new Date().toISOString()
              });

              await logWorkflowExecutionActivity({
                workflowId,
                workflowType: 'leadFollowUpWorkflow',
                status: 'COMPLETED',
                input: options,
                output: result,
              });

              return result;
            } else if (messageStatus === 'accepted') {
              console.log(`✅ Message accepted after polling - proceeding with sending`);
            } else if (messageStatus === undefined) {
              console.log(`⚠️ Message no longer exists - message was deleted during polling, cancelling delivery`);
              errors.push('Message was deleted during polling - delivery cancelled');
              
              // Execute cleanup since message was deleted
              console.log(`🧹 Message was deleted during polling - executing cleanup...`);
              
              try {
                const cleanupResult = await cleanupFailedFollowUpActivity({
                  lead_id: lead_id,
                  site_id: site_id,
                  conversation_id: logsResult?.conversation_ids?.[0],
                  message_id: primaryMessageId,
                  failure_reason: 'message_deleted_by_user_during_polling',
                  delivery_channel: undefined
                });
                
                if (cleanupResult.success) {
                  console.log(`✅ Cleanup completed after message deletion during polling`);
                } else {
                  console.error(`⚠️ Cleanup failed: ${cleanupResult.error}`);
                  errors.push(`Cleanup failed: ${cleanupResult.error}`);
                }
              } catch (cleanupError) {
                const cleanupErrorMessage = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
                console.error(`⚠️ Exception during cleanup: ${cleanupErrorMessage}`);
                errors.push(`Cleanup exception: ${cleanupErrorMessage}`);
              }
              
              // Complete workflow without sending
              const executionTime = `${((Date.now() - startTime) / 1000).toFixed(2)}s`;
              const result: LeadFollowUpResult = {
                success: true,
                leadId: lead_id,
                siteId: site_id,
                siteName,
                siteUrl,
                followUpActions,
                nextSteps,
                data: response,
                messageSent: undefined,
                errors: errors,
                executionTime,
                completedAt: new Date().toISOString()
              };

              await saveCronStatusActivity({
                siteId: site_id,
                workflowId,
                scheduleId: `lead-follow-up-${lead_id}-${site_id}`,
                activityName: 'leadFollowUpWorkflow',
                status: 'COMPLETED',
                lastRun: new Date().toISOString()
              });

              await logWorkflowExecutionActivity({
                workflowId,
                workflowType: 'leadFollowUpWorkflow',
                status: 'COMPLETED',
                input: options,
                output: result,
              });

              return result;
            }
          } else if (currentStatus === 'accepted') {
            console.log(`✅ Message is already accepted - proceeding with sending`);
          } else if (currentStatus === 'sent' || currentStatus === 'failed') {
            console.log(`⚠️ Message status is already '${currentStatus}' - skipping send`);
            // Complete workflow without sending
            const executionTime = `${((Date.now() - startTime) / 1000).toFixed(2)}s`;
            const result: LeadFollowUpResult = {
              success: true,
              leadId: lead_id,
              siteId: site_id,
              siteName,
              siteUrl,
              followUpActions,
              nextSteps,
              data: response,
              messageSent: undefined,
              errors: [...errors, `Message status is '${currentStatus}' - already processed`],
              executionTime,
              completedAt: new Date().toISOString()
            };

            await saveCronStatusActivity({
              siteId: site_id,
              workflowId,
              scheduleId: `lead-follow-up-${lead_id}-${site_id}`,
              activityName: 'leadFollowUpWorkflow',
              status: 'COMPLETED',
              lastRun: new Date().toISOString()
            });

            await logWorkflowExecutionActivity({
              workflowId,
              workflowType: 'leadFollowUpWorkflow',
              status: 'COMPLETED',
              input: options,
              output: result,
            });

            return result;
          } else {
            console.log(`⚠️ Message status is '${currentStatus || 'undefined'}' - proceeding with sending as fallback`);
          }
        }
      }
      
            // Step 5.3: Final validation before sending - ensure messages still exist after the wait period
      console.log(`🔍 Step 5.3: Performing final validation before message sending...`);
      console.log(`📝 Validating message IDs from logs: ${logsResult?.message_ids?.join(', ') || 'None'}`);
      console.log(`💬 Validating conversation IDs from logs: ${logsResult?.conversation_ids?.join(', ') || 'None'}`);
      console.log(`🎯 Primary message_id for validation: ${logsResult?.message_ids?.[0] || 'None'}`);
      console.log(`🎯 Primary conversation_id for validation: ${logsResult?.conversation_ids?.[0] || 'None'}`);
      
      const messageValidationResult = await validateMessageAndConversationActivity({
        lead_id: lead_id,
        site_id: site_id,
        message_id: logsResult?.message_ids?.[0], // Pass specific message_id to validate
        response_data: response,
        additional_data: {
          ...options.additionalData,
          message_ids: logsResult?.message_ids,
          conversation_ids: logsResult?.conversation_ids,
          conversation_id: logsResult?.conversation_ids?.[0], // Also pass conversation_id directly
          validate_before_send: true
        }
      });
      
      if (!messageValidationResult.success) {
        const errorMsg = `Final validation failed: ${messageValidationResult.error}`;
        console.error(`❌ ${errorMsg}`);
        console.error(`🔍 Validation details:`);
        console.error(`   - Conversation exists: ${messageValidationResult.conversation_exists}`);
        console.error(`   - Message exists: ${messageValidationResult.message_exists}`);
        console.error(`   - Conversation ID: ${messageValidationResult.conversation_id || 'None'}`);
        console.error(`   - Message ID: ${messageValidationResult.message_id || 'None'}`);
        errors.push(errorMsg);
        
        // Execute cleanup since messages/conversation no longer exist
        console.log(`🧹 Validation failed after 2-hour wait - executing cleanup...`);
        console.log(`📋 Validation failure type: ${messageValidationResult.error}`);
        
        try {
          // Determine specific failure reason based on validation result
          let failureReason = 'validation_failed_after_wait_period';
          if (messageValidationResult.error?.includes('conversation was deleted')) {
            failureReason = 'conversation_deleted_by_user_during_wait_period';
          } else if (messageValidationResult.error?.includes('message not found')) {
            failureReason = 'message_deleted_during_wait_period';
          } else if (messageValidationResult.error?.includes('no conversation found')) {
            failureReason = 'no_conversation_exists_for_lead';
          }
          
          console.log(`🔍 Using failure reason: ${failureReason}`);
          
          const cleanupResult = await cleanupFailedFollowUpActivity({
            lead_id: lead_id,
            site_id: site_id,
            conversation_id: logsResult?.conversation_ids?.[0],
            message_id: logsResult?.message_ids?.[0],
            failure_reason: failureReason,
            delivery_channel: undefined
          });
          
          if (cleanupResult.success) {
            console.log(`✅ Cleanup completed after validation failure`);
          } else {
            console.error(`⚠️ Cleanup failed: ${cleanupResult.error}`);
            errors.push(`Cleanup failed: ${cleanupResult.error}`);
          }
        } catch (cleanupError) {
          const cleanupErrorMessage = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
          console.error(`⚠️ Exception during cleanup: ${cleanupErrorMessage}`);
          errors.push(`Cleanup exception: ${cleanupErrorMessage}`);
        }
        
        // Early exit without sending messages
        const executionTime = `${((Date.now() - startTime) / 1000).toFixed(2)}s`;
        const result: LeadFollowUpResult = {
          success: true,
          leadId: lead_id,
          siteId: site_id,
          siteName,
          siteUrl,
          followUpActions,
          nextSteps,
          data: response,
          messageSent: undefined,
          errors: [...errors, `Validation failed after wait period: ${messageValidationResult.error} - delivery cancelled`],
          executionTime,
          completedAt: new Date().toISOString()
        };

        console.log(`⚠️ Lead follow-up workflow completed - validation failed: ${messageValidationResult.error}`);
        if (messageValidationResult.error?.includes('conversation was deleted')) {
          console.log(`💬 User likely deleted the conversation during the 2-hour wait period`);
        }

        // Update cron status
        await saveCronStatusActivity({
          siteId: site_id,
          workflowId,
          scheduleId: `lead-follow-up-${lead_id}-${site_id}`,
          activityName: 'leadFollowUpWorkflow',
          status: 'COMPLETED',
          lastRun: new Date().toISOString()
        });

        // Log completion
        await logWorkflowExecutionActivity({
          workflowId,
          workflowType: 'leadFollowUpWorkflow',
          status: 'COMPLETED',
          input: options,
          output: result,
        });

        return result;
      } else {
        console.log(`✅ Final validation successful - proceeding with message delivery`);
        console.log(`📊 Validation confirmed:`);
        console.log(`   - Conversation ${messageValidationResult.conversation_id} exists and is ready`);
        console.log(`   - Message ${messageValidationResult.message_id} exists and is ready for processing`);
      }
      
              console.log(`📤 Step 5.3: Now sending follow-up message based on communication channel...`);
      
      try {
        const responseData = response; // response is already the response data
        const messages = responseData.data?.messages || responseData.messages || {};
        const lead = responseData.data?.lead || responseData.lead || {};
        
        // Extract contact information
        const email = lead.email || lead.contact_email;
        const phone = lead.phone || lead.phone_number;
        
        // Extract message content from the correct structure
        const emailMessage = messages.email?.message;
        const emailTitle = messages.email?.title;
        const whatsappMessage = messages.whatsapp?.message;
        
        console.log(`📞 Contact info - Email: ${email}, Phone: ${phone}`);
        console.log(`📝 Messages available - Email: ${!!emailMessage}, WhatsApp: ${!!whatsappMessage}`);
        
        // Note: Contact validation was already performed in Step 4.5, so we can proceed with sending
        
        let emailSent = false;
        let whatsappSent = false;
        
        // Send email if available and not invalidated during early validation
        if (email && emailMessage && !emailInvalidatedInEarlyValidation) {
          console.log(`📧 Sending follow-up email to ${email} (contact validation already performed)...`);
          
          const emailResult = await sendEmailFromAgentActivity({
            email: email,
            subject: emailTitle || `Follow-up: ${lead.name || 'Lead'} - ${siteName}`,
            message: emailMessage,
            site_id: site_id,
            agent_id: options.userId || site.user_id,
            lead_id: lead_id,
            from: siteName,
          });
          
          if (emailResult.success) {
            console.log(`✅ Follow-up email sent successfully to ${email}`);
            emailSent = true;
            messageSent = {
              channel: 'email',
              recipient: email,
              success: true,
              messageId: emailResult.messageId,
            };
          } else {
            const errorMsg = `Failed to send follow-up email: ${emailResult.messageId}`;
            console.error(`⚠️ ${errorMsg}`);
            errors.push(errorMsg);
            
            // Execute cleanup when email delivery fails
            console.log(`🧹 Email delivery failed, executing cleanup...`);
            
            try {
              // Use actual conversation_id and message_id from logs if available
              const conversationId = logsResult?.conversation_ids?.[0];
              const messageId = logsResult?.message_ids?.[0];
              
              console.log(`🔍 Cleanup using: conversation_id=${conversationId}, message_id=${messageId}`);
              
              const cleanupResult = await cleanupFailedFollowUpActivity({
                lead_id: lead_id,
                site_id: site_id,
                conversation_id: conversationId,
                message_id: messageId,
                failure_reason: `email_delivery_failed: ${emailResult.messageId}`,
                delivery_channel: 'email',
                email: email
              });
              
              if (cleanupResult.success) {
                console.log(`✅ Cleanup completed after email failure`);
              } else {
                console.error(`⚠️ Cleanup failed after email failure: ${cleanupResult.error}`);
                errors.push(`Cleanup failed: ${cleanupResult.error}`);
              }
            } catch (cleanupError) {
              const cleanupErrorMessage = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
              console.error(`⚠️ Exception during cleanup after email failure: ${cleanupErrorMessage}`);
              errors.push(`Cleanup exception: ${cleanupErrorMessage}`);
            }
          }
        } else if (email && emailMessage && emailInvalidatedInEarlyValidation) {
          console.log(`🚫 Skipping email sending - email was invalidated during early validation: ${email}`);
          console.log(`📱 Will attempt WhatsApp delivery if available instead`);
        }
        
        // Send WhatsApp if available
        if (phone && whatsappMessage) {
          console.log(`📱 Sending follow-up WhatsApp to ${phone}...`);
          
          // Format phone number for international compatibility
          const formattedPhone = formatPhoneNumber(phone);
          console.log(`📞 Phone format: ${phone} -> ${formattedPhone}`);
          
          try {
            const whatsappWorkflowId = `send-whatsapp-agent-${lead_id}-${Date.now()}`;
            const whatsappHandle = await startChild(sendWhatsappFromAgent, {
              workflowId: whatsappWorkflowId,
              args: [{
                phone_number: formattedPhone,
                message: whatsappMessage,
                site_id: site_id,
                from: siteName,
                agent_id: options.userId || site.user_id,
                lead_id: lead_id,
                conversation_id: logsResult?.conversation_ids?.[0],
                message_id: logsResult?.message_ids?.[0],
                responseWindowEnabled: false,
              }],
              parentClosePolicy: ParentClosePolicy.PARENT_CLOSE_POLICY_TERMINATE,
            });

            const whatsappResult = await whatsappHandle.result();
            
            // If we reach here, WhatsApp was sent successfully
            console.log(`✅ Follow-up WhatsApp sent successfully to ${formattedPhone}`);
            whatsappSent = true;
            // If no email was sent or email failed, set WhatsApp as primary message sent
            if (!emailSent) {
              messageSent = {
                channel: 'whatsapp',
                recipient: formattedPhone,
                success: true,
              messageId: whatsappResult.messageId,
              };
            }
            
          } catch (whatsappError) {
            // This catch block will handle both activity exceptions and result.success === false cases
            const whatsappErrorMessage = whatsappError instanceof Error ? whatsappError.message : String(whatsappError);
            const errorMsg = `Failed to send follow-up WhatsApp: ${whatsappErrorMessage}`;
            console.error(`⚠️ ${errorMsg}`);
            errors.push(errorMsg);
            
            // Execute lead invalidation workflow when WhatsApp fails
            console.log(`🚫 WhatsApp delivery failed, executing lead invalidation workflow...`);
            console.log(`📋 Failure details:`);
            console.log(`   - Original phone: ${phone}`);
            console.log(`   - Formatted phone: ${formattedPhone}`);
            console.log(`   - Error: ${whatsappErrorMessage}`);
            
            try {
              const invalidationOptions: LeadInvalidationOptions = {
                lead_id: lead_id,
                site_id: site_id,
                telephone: formattedPhone,
                reason: 'whatsapp_failed',
                userId: options.userId || site.user_id,
                additionalData: {
                  original_phone: phone,
                  formatted_phone: formattedPhone,
                  whatsapp_error: whatsappErrorMessage,
                  failed_in_workflow: 'leadFollowUpWorkflow',
                  failed_at: new Date().toISOString(),
                  error_type: 'activity_exception'
                }
              };
              
              console.log(`🚀 Starting lead invalidation workflow...`);
              const invalidationHandle = await startChild(leadInvalidationWorkflow, {
                args: [invalidationOptions],
                workflowId: `lead-invalidation-whatsapp-${lead_id}-${Date.now()}`,
              });
              
              const invalidationResult = await invalidationHandle.result();
              
              if (invalidationResult.success) {
                console.log(`✅ Lead invalidation completed successfully`);
                console.log(`📊 Invalidation summary:`);
                console.log(`   - Lead invalidated: ${invalidationResult.invalidatedLead}`);
                console.log(`   - Shared leads invalidated: ${invalidationResult.invalidatedSharedLeads}`);
                console.log(`   - Original site_id: ${invalidationResult.originalSiteId}`);
              } else {
                console.error(`⚠️ Lead invalidation failed: ${invalidationResult.errors.join(', ')}`);
                errors.push(`Lead invalidation failed: ${invalidationResult.errors.join(', ')}`);
              }
              
            } catch (invalidationError) {
              const invalidationErrorMessage = invalidationError instanceof Error ? invalidationError.message : String(invalidationError);
              console.error(`⚠️ Exception during lead invalidation: ${invalidationErrorMessage}`);
              errors.push(`Lead invalidation exception: ${invalidationErrorMessage}`);
            }
            
            // Execute cleanup when WhatsApp delivery fails
            console.log(`🧹 WhatsApp delivery failed, executing cleanup...`);
            
            try {
              // Use actual conversation_id and message_id from logs if available
              const conversationId = logsResult?.conversation_ids?.[0];
              const messageId = logsResult?.message_ids?.[0];
              
              console.log(`🔍 Cleanup using: conversation_id=${conversationId}, message_id=${messageId}`);
              
              const cleanupResult = await cleanupFailedFollowUpActivity({
                lead_id: lead_id,
                site_id: site_id,
                conversation_id: conversationId,
                message_id: messageId,
                failure_reason: `whatsapp_delivery_failed: ${whatsappErrorMessage}`,
                delivery_channel: 'whatsapp',
                phone_number: formattedPhone
              });
              
              if (cleanupResult.success) {
                console.log(`✅ Cleanup completed after WhatsApp failure:`);
                console.log(`   - Conversation deleted: ${cleanupResult.conversation_deleted}`);
                console.log(`   - Message deleted: ${cleanupResult.message_deleted}`);
                console.log(`   - Task deleted: ${cleanupResult.task_deleted}`);
                console.log(`   - Lead reset to 'new': ${cleanupResult.lead_reset_to_new}`);
              } else {
                console.error(`⚠️ Cleanup failed after WhatsApp failure: ${cleanupResult.error}`);
                errors.push(`Cleanup failed: ${cleanupResult.error}`);
              }
            } catch (cleanupError) {
              const cleanupErrorMessage = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
              console.error(`⚠️ Exception during cleanup after WhatsApp failure: ${cleanupErrorMessage}`);
              errors.push(`Cleanup exception: ${cleanupErrorMessage}`);
            }
          }
        }
        
        // Log results
        if (emailSent || whatsappSent) {
          console.log(`✅ Follow-up messages sent - Email: ${emailSent}, WhatsApp: ${whatsappSent}`);
        } else {
          if (!email && !phone) {
            console.log(`⚠️ No valid communication channels found (email: ${email}, phone: ${phone})`);
            errors.push('No valid communication channels found for follow-up message');
          } else if (!emailMessage && !whatsappMessage) {
            console.log(`⚠️ No message content found in follow-up response`);
            errors.push('No message content found in follow-up response');
          } else {
            console.log(`⚠️ Messages available but delivery failed`);
            errors.push('Messages available but delivery failed');
            
            // Execute cleanup when messages are available but delivery failed
            console.log(`🧹 Message delivery failed (both channels), executing cleanup...`);
            
            try {
              // Use actual conversation_id and message_id from logs if available
              const conversationId = logsResult?.conversation_ids?.[0];
              const messageId = logsResult?.message_ids?.[0];
              
              console.log(`🔍 Cleanup using: conversation_id=${conversationId}, message_id=${messageId}`);
              
              const cleanupResult = await cleanupFailedFollowUpActivity({
                lead_id: lead_id,
                site_id: site_id,
                conversation_id: conversationId,
                message_id: messageId,
                failure_reason: 'all_message_delivery_failed',
                delivery_channel: emailMessage ? 'email' : 'whatsapp',
                email: email,
                phone_number: phone
              });
              
              if (cleanupResult.success) {
                console.log(`✅ Cleanup completed after total delivery failure:`);
                console.log(`   - Conversation deleted: ${cleanupResult.conversation_deleted}`);
                console.log(`   - Message deleted: ${cleanupResult.message_deleted}`);
                console.log(`   - Task deleted: ${cleanupResult.task_deleted}`);
                console.log(`   - Lead reset to 'new': ${cleanupResult.lead_reset_to_new}`);
              } else {
                console.error(`⚠️ Cleanup failed after total delivery failure: ${cleanupResult.error}`);
                errors.push(`Cleanup failed: ${cleanupResult.error}`);
              }
            } catch (cleanupError) {
              const cleanupErrorMessage = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
              console.error(`⚠️ Exception during cleanup after total delivery failure: ${cleanupErrorMessage}`);
              errors.push(`Cleanup exception: ${cleanupErrorMessage}`);
            }
          }
        }

        // Step 5.4: Mark first_contact task as completed after successful message delivery
        if (emailSent || whatsappSent) {
          console.log(`📝 Step 5.3: Marking first_contact task as completed after successful message delivery...`);
          
          const taskUpdateResult = await updateTaskStatusToCompletedActivity({
            lead_id: lead_id,
            site_id: site_id,
            stage: 'awareness', // First contact tasks are typically in awareness stage
            status: 'completed',
            notes: `Task completed after successful ${emailSent ? 'email' : 'WhatsApp'} message delivery via leadFollowUpWorkflow`
          });
          
          if (taskUpdateResult.success) {
            if (taskUpdateResult.updated_task_id) {
              console.log(`✅ First_contact task ${taskUpdateResult.updated_task_id} marked as completed`);
            } else {
              console.log(`✅ First_contact task completion update completed (${taskUpdateResult.task_found ? 'no task to update' : 'no task found'})`);
            }
          } else {
            const errorMsg = `Failed to mark first_contact task as completed: ${taskUpdateResult.error}`;
            console.error(`⚠️ ${errorMsg}`);
            errors.push(errorMsg);
            // Note: We don't throw here as the main operation was successful
          }
        } else {
          console.log(`⚠️ Skipping first_contact task completion - no successful message delivery`);
        }
        
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`⚠️ Failed to send follow-up message: ${errorMessage}`);
        errors.push(`Failed to send follow-up message: ${errorMessage}`);
        // Note: We don't throw here as the main operation was successful
      }
    }

        // Step 5.5: Update message status to 'sent' after successful delivery
    if (messageSent && messageSent.success) {
      console.log(`📝 Step 5.4: Updating message status to 'sent'...`);
      
      // Use actual conversation_id and message_id from logs if available
      const conversationId = logsResult?.conversation_ids?.[0];
      let messageId = logsResult?.message_ids?.[0];
      
      console.log(`🔍 Initial IDs from logs: conversation_id=${conversationId}, message_id=${messageId}`);
      
      // Fallback: If logs didn't provide IDs, try to get them from the message sent result
      if (!messageId && messageSent.messageId) {
        console.log(`🔍 Logs didn't provide message_id, using messageId from send result: ${messageSent.messageId}`);
        messageId = messageSent.messageId;
      }
      
      // Additional fallback: Search for recent messages for this lead if we still don't have IDs
      if (!messageId && !conversationId) {
        console.log(`🔍 No IDs available from logs or send result, will let updateMessageStatusToSentActivity search by lead_id`);
      }
      
      console.log(`🔍 Final IDs for message status update: conversation_id=${conversationId}, message_id=${messageId}`);
      
      const messageUpdateResult = await updateMessageStatusToSentActivity({
        message_id: messageId,
        conversation_id: conversationId,
        lead_id: lead_id,
        site_id: site_id,
        delivery_channel: messageSent.channel,
        delivery_success: true,
        delivery_details: {
          recipient: messageSent.recipient,
          message_id: messageSent.messageId,
          timestamp: new Date().toISOString()
        }
      });
      
      if (messageUpdateResult.success) {
        if (messageUpdateResult.updated_message_id) {
          console.log(`✅ Message ${messageUpdateResult.updated_message_id} status updated to 'sent'`);
        } else {
          console.log(`✅ Message status update completed (no message to update)`);
        }
      } else {
        const errorMsg = `Failed to update message status: ${messageUpdateResult.error}`;
        console.error(`⚠️ ${errorMsg}`);
        errors.push(errorMsg);
        // Note: We don't throw here as the main operation was successful
      }
    } else {
      console.log(`⚠️ Skipping message status update - no successful delivery`);
    }

    // Step 5.5.1: Update message timestamp to sync with real delivery time
    if (messageSent && messageSent.success) {
      console.log(`⏰ Step 5.4.1: Syncing message timestamp with actual delivery time...`);
      
      // Use the same fallback logic as the status update
      const conversationId = logsResult?.conversation_ids?.[0];
      let messageId = logsResult?.message_ids?.[0];
      
      // Fallback: If logs didn't provide IDs, try to get them from the message sent result
      if (!messageId && messageSent.messageId) {
        console.log(`🔍 Using messageId from send result for timestamp sync: ${messageSent.messageId}`);
        messageId = messageSent.messageId;
      }
      
      console.log(`🔍 Updating message timestamp using: conversation_id=${conversationId}, message_id=${messageId}`);
      
      const timestampUpdateResult = await updateMessageTimestampActivity({
        message_id: messageId,
        conversation_id: conversationId,
        lead_id: lead_id,
        site_id: site_id,
        delivery_timestamp: new Date().toISOString(), // Use actual delivery time
        delivery_channel: messageSent.channel
      });
      
      if (timestampUpdateResult.success) {
        if (timestampUpdateResult.updated_message_id) {
          console.log(`✅ Message ${timestampUpdateResult.updated_message_id} timestamp synced with delivery time`);
          console.log(`📅 Message now shows actual delivery time instead of creation time`);
        } else {
          console.log(`✅ Message timestamp sync completed (no message to update)`);
        }
      } else {
        const errorMsg = `Failed to sync message timestamp: ${timestampUpdateResult.error}`;
        console.error(`⚠️ ${errorMsg}`);
        errors.push(errorMsg);
        // Note: We don't throw here as the main operation was successful
      }
    } else {
      console.log(`⚠️ Skipping message timestamp sync - no successful delivery`);
    }

    // Step 5.6: Activate conversation after successful follow-up
    if (messageSent && messageSent.success) {
      console.log(`💬 Step 5.5: Activating conversation after successful lead follow-up...`);
      console.log(`🔍 Conversation IDs from logs: ${logsResult?.conversation_ids?.join(', ') || 'None'}`);
      console.log(`📝 Message IDs from logs: ${logsResult?.message_ids?.join(', ') || 'None'}`);
      console.log(`🔍 Using conversation_id: ${logsResult?.conversation_ids?.[0] || 'None (will search by lead_id)'}`);
      
      const conversationUpdateResult = await updateConversationStatusAfterFollowUpActivity({
        conversation_id: logsResult?.conversation_ids?.[0], // Pass the conversation_id from logs
        lead_id: lead_id,
        site_id: site_id,
        response_data: response,
        additional_data: {
          ...options.additionalData,
          conversation_ids: logsResult?.conversation_ids,
          message_ids: logsResult?.message_ids
        }
      });
      
      if (conversationUpdateResult.success) {
        if (conversationUpdateResult.conversation_id) {
          console.log(`✅ Successfully activated conversation ${conversationUpdateResult.conversation_id}`);
        } else {
          console.log(`✅ Conversation activation completed (no conversation found to update)`);
          console.log(`📋 This is normal for leads without existing conversations`);
        }
      } else {
        const errorMsg = `Failed to activate conversation: ${conversationUpdateResult.error}`;
        console.error(`❌ ${errorMsg}`);
        console.error(`🔍 Debug info for conversation update failure:`);
        console.error(`   - Lead ID: ${lead_id}`);
        console.error(`   - Site ID: ${site_id}`);
        console.error(`   - Conversation ID from logs: ${logsResult?.conversation_ids?.[0] || 'None'}`);
        console.error(`   - Available conversation IDs: ${logsResult?.conversation_ids?.join(', ') || 'None'}`);
        console.error(`   - Available message IDs: ${logsResult?.message_ids?.join(', ') || 'None'}`);
        errors.push(errorMsg);
        // Note: We don't throw here as the main operation (message sending) was successful
        // The message status has already been updated to 'sent' which is the primary goal
      }
    } else {
      console.log(`⚠️ Skipping conversation activation - no successful message delivery`);
    }

    const executionTime = `${((Date.now() - startTime) / 1000).toFixed(2)}s`;
    const result: LeadFollowUpResult = {
      success: true,
      leadId: lead_id,
      siteId: site_id,
      siteName,
      siteUrl,
      followUpActions,
      nextSteps,
      data: response,
      messageSent,
      errors,
      executionTime,
      completedAt: new Date().toISOString()
    };

    console.log(`🎉 Lead follow-up workflow completed successfully!`);
    console.log(`📊 Summary: Lead ${lead_id} follow-up completed for ${siteName} in ${executionTime}`);
    
    if (messageSent) {
      const status = messageSent.success ? '✅ sent' : '❌ failed';
      console.log(`📤 Follow-up message ${status} via ${messageSent.channel} to ${messageSent.recipient}`);
    }

    // Update cron status to indicate successful completion
    await saveCronStatusActivity({
      siteId: site_id,
      workflowId,
      scheduleId: `lead-follow-up-${lead_id}-${site_id}`,
      activityName: 'leadFollowUpWorkflow',
      status: 'COMPLETED',
      lastRun: new Date().toISOString()
    });

    // Log successful completion
    await logWorkflowExecutionActivity({
      workflowId,
      workflowType: 'leadFollowUpWorkflow',
      status: 'COMPLETED',
      input: options,
      output: result,
    });

    return result;

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Lead follow-up workflow failed: ${errorMessage}`);
    
    // Update cron status to indicate failure
    await saveCronStatusActivity({
      siteId: site_id,
      workflowId,
      scheduleId: `lead-follow-up-${lead_id}-${site_id}`,
      activityName: 'leadFollowUpWorkflow',
      status: 'FAILED',
      lastRun: new Date().toISOString(),
      errorMessage: errorMessage,
      retryCount: 1
    });

    // Log workflow execution failure
    await logWorkflowExecutionActivity({
      workflowId,
      workflowType: 'leadFollowUpWorkflow',
      status: 'FAILED',
      input: options,
      error: errorMessage,
    });

    // Throw error to properly fail the workflow
    throw new Error(`Lead follow-up workflow failed: ${errorMessage}`);
  }
} 