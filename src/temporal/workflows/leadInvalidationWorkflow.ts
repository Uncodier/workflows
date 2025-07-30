import { proxyActivities } from '@temporalio/workflow';
import type { Activities } from '../activities';

// Define the activity interface and options
const { 
  logWorkflowExecutionActivity,
  saveCronStatusActivity,
  getLeadActivity,
  invalidateLeadActivity,
  findLeadsBySharedContactActivity,
} = proxyActivities<Activities>({
  startToCloseTimeout: '3 minutes', // Reasonable timeout for lead invalidation
  retry: {
    maximumAttempts: 3,
  },
});

export interface LeadInvalidationOptions {
  lead_id: string;                    // Required: Lead ID to invalidate
  site_id: string;                    // Required: Site ID for tracking
  telephone?: string;                 // Optional: Failed telephone number
  email?: string;                     // Optional: Failed email address
  reason?: 'whatsapp_failed' | 'email_failed' | 'invalid_contact' | 'invalid_email' | 'invalid_phone'; // Optional: Reason for invalidation
  userId?: string;                    // Optional: User ID for logging
  additionalData?: any;               // Optional: Additional context data
}

export interface LeadInvalidationResult {
  success: boolean;
  leadId: string;
  originalSiteId: string;
  invalidatedLead: boolean;
  sharedContactLeads?: string[];      // IDs of other leads with shared contact
  invalidatedSharedLeads: number;     // Count of shared leads invalidated
  reason: string;
  errors: string[];
  executionTime: string;
  completedAt: string;
}

/**
 * Workflow to invalidate leads when communication fails
 * 
 * This workflow:
 * 1. Gets the lead information from database
 * 2. Checks if lead has alternative contact methods
 * 3. If no alternative contact, removes site_id and adds invalidation metadata
 * 4. Finds other leads sharing the same failed contact information
 * 5. Invalidates shared leads and adds metadata for revalidation
 * 
 * @param options - Configuration options for lead invalidation
 */
export async function leadInvalidationWorkflow(
  options: LeadInvalidationOptions
): Promise<LeadInvalidationResult> {
  const { lead_id, site_id } = options;
  // Set default reason if not provided and map legacy reasons
  let reason = options.reason || 'invalid_contact';
  
  // Map legacy reasons to proper communication failure reasons for metadata tracking
  if (reason === 'invalid_email') {
    reason = 'email_failed';
  } else if (reason === 'invalid_phone') {
    reason = 'whatsapp_failed';
  }
  
  console.log(`📋 Original reason: ${options.reason}, Mapped reason: ${reason}`);
  
  if (!lead_id) {
    throw new Error('No lead ID provided');
  }
  
  if (!site_id) {
    throw new Error('No site ID provided');
  }
  
  const workflowId = `lead-invalidation-${lead_id}-${Date.now()}`;
  const startTime = Date.now();
  
  console.log(`🚫 Starting lead invalidation workflow for lead ${lead_id}`);
  console.log(`📋 Reason: ${reason}`);
  console.log(`📞 Failed telephone: ${options.telephone || 'N/A'}`);
  console.log(`📧 Failed email: ${options.email || 'N/A'}`);

  // Log workflow execution start
  await logWorkflowExecutionActivity({
    workflowId,
    workflowType: 'leadInvalidationWorkflow',
    status: 'STARTED',
    input: options,
  });

  // Update cron status to indicate the workflow is running
  await saveCronStatusActivity({
    siteId: site_id,
    workflowId,
    scheduleId: `lead-invalidation-${lead_id}`,
    activityName: 'leadInvalidationWorkflow',
    status: 'RUNNING',
    lastRun: new Date().toISOString()
  });

  const errors: string[] = [];
  let leadInvalidated = false;
  let sharedContactLeads: string[] = [];
  let invalidatedSharedLeads = 0;
  let originalSiteId = site_id;

  try {
    console.log(`👤 Step 1: Getting lead information for ${lead_id}...`);
    
    // Get lead information to check current contact methods
    const leadResult = await getLeadActivity(lead_id);
    
    if (!leadResult.success) {
      const errorMsg = `Failed to get lead information: ${leadResult.error}`;
      console.error(`❌ ${errorMsg}`);
      errors.push(errorMsg);
      throw new Error(errorMsg);
    }
    
    const lead = leadResult.lead!;
    originalSiteId = lead.site_id || site_id;
    
    console.log(`✅ Retrieved lead information: ${lead.name || lead.email}`);
    console.log(`📋 Lead details:`);
    console.log(`   - Current site_id: ${lead.site_id}`);
    console.log(`   - Email: ${lead.email || 'N/A'}`);
    console.log(`   - Phone: ${lead.phone || 'N/A'}`);
    console.log(`   - Has alternative contact: ${hasAlternativeContact(lead, options)}`);

    // Step 2: Invalidate lead (remove site_id and add metadata)
    console.log(`🔍 Step 2: Invalidating lead (removing site_id and adding metadata)...`);
    
    // Always invalidate the lead when this workflow is called
    // This ensures proper tracking even if lead has alternative contact methods
    const hasAlternative = hasAlternativeContact(lead, options);
    console.log(`📋 Lead has alternative contact methods: ${hasAlternative}`);
    console.log(`🚫 Proceeding with invalidation regardless (for tracking purposes)`);
    
    const invalidationResult = await invalidateLeadActivity({
      lead_id: lead_id,
      original_site_id: originalSiteId,
      reason: reason,
      failed_contact: {
        telephone: options.telephone,
        email: options.email
      },
      userId: options.userId
    });
    
    if (invalidationResult.success) {
      leadInvalidated = true;
      console.log(`✅ Lead ${lead_id} invalidated successfully`);
      console.log(`📝 site_id removed and invalidation metadata added`);
    } else {
      const errorMsg = `Failed to invalidate lead: ${invalidationResult.error}`;
      console.error(`❌ ${errorMsg}`);
      errors.push(errorMsg);
    }

    // Step 3: Find and invalidate leads with shared contact information
    console.log(`🔍 Step 3: Finding leads with shared failed contact information...`);
    
    if (options.email || options.telephone) {
      const sharedLeadsResult = await findLeadsBySharedContactActivity({
        email: options.email,
        telephone: options.telephone,
        exclude_lead_id: lead_id,
        site_id: site_id
      });
      
      if (sharedLeadsResult.success && sharedLeadsResult.leads && sharedLeadsResult.leads.length > 0) {
        sharedContactLeads = sharedLeadsResult.leads.map((l: any) => l.id);
        console.log(`🔍 Found ${sharedContactLeads.length} leads sharing failed contact information`);
        
        // Step 3a: Invalidate shared leads
        console.log(`🚫 Step 3a: Invalidating shared contact leads...`);
        
        for (const sharedLeadId of sharedContactLeads) {
          try {
            const sharedInvalidationResult = await invalidateLeadActivity({
              lead_id: sharedLeadId,
              original_site_id: site_id,
              reason: `shared_${reason}`,
              failed_contact: {
                telephone: options.telephone,
                email: options.email
              },
              userId: options.userId,
              shared_with_lead_id: lead_id
            });
            
            if (sharedInvalidationResult.success) {
              invalidatedSharedLeads++;
              console.log(`✅ Shared lead ${sharedLeadId} invalidated successfully`);
            } else {
              const errorMsg = `Failed to invalidate shared lead ${sharedLeadId}: ${sharedInvalidationResult.error}`;
              console.error(`⚠️ ${errorMsg}`);
              errors.push(errorMsg);
            }
          } catch (sharedError) {
            const errorMessage = sharedError instanceof Error ? sharedError.message : String(sharedError);
            console.error(`⚠️ Exception invalidating shared lead ${sharedLeadId}: ${errorMessage}`);
            errors.push(`Shared lead invalidation exception: ${errorMessage}`);
          }
        }
        
        console.log(`📊 Shared leads invalidation summary: ${invalidatedSharedLeads}/${sharedContactLeads.length} successful`);
      } else {
        console.log(`ℹ️ No other leads found sharing the failed contact information`);
      }
    } else {
      console.log(`⚠️ No contact information provided for shared lead search`);
    }

    console.log(`✅ Lead invalidation process completed - skipping company null list functionality`);
    console.log(`📝 Note: Company tracking has been simplified to focus on lead-level invalidation`);

    const executionTime = `${((Date.now() - startTime) / 1000).toFixed(2)}s`;
    const result: LeadInvalidationResult = {
      success: true,
      leadId: lead_id,
      originalSiteId,
      invalidatedLead: leadInvalidated,
      sharedContactLeads,
      invalidatedSharedLeads,
      reason,
      errors,
      executionTime,
      completedAt: new Date().toISOString()
    };

    console.log(`🎉 Lead invalidation workflow completed successfully!`);
    console.log(`📊 Summary: Lead ${lead_id} - Invalidated: ${leadInvalidated}, Shared leads: ${invalidatedSharedLeads}`);
    console.log(`⏱️ Execution time: ${executionTime}`);

    // Update cron status to indicate successful completion
    await saveCronStatusActivity({
      siteId: site_id,
      workflowId,
      scheduleId: `lead-invalidation-${lead_id}`,
      activityName: 'leadInvalidationWorkflow',
      status: 'COMPLETED',
      lastRun: new Date().toISOString()
    });

    // Log successful completion
    await logWorkflowExecutionActivity({
      workflowId,
      workflowType: 'leadInvalidationWorkflow',
      status: 'COMPLETED',
      input: options,
      output: result,
    });

    return result;

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Lead invalidation workflow failed: ${errorMessage}`);
    
    const executionTime = `${((Date.now() - startTime) / 1000).toFixed(2)}s`;
    
    // Update cron status to indicate failure
    await saveCronStatusActivity({
      siteId: site_id,
      workflowId,
      scheduleId: `lead-invalidation-${lead_id}`,
      activityName: 'leadInvalidationWorkflow',
      status: 'FAILED',
      lastRun: new Date().toISOString(),
      errorMessage: errorMessage,
      retryCount: 1
    });

    // Log workflow execution failure
    await logWorkflowExecutionActivity({
      workflowId,
      workflowType: 'leadInvalidationWorkflow',
      status: 'FAILED',
      input: options,
      error: errorMessage,
    });

    // Return failed result instead of throwing to provide more information
    const result: LeadInvalidationResult = {
      success: false,
      leadId: lead_id,
      originalSiteId,
      invalidatedLead: leadInvalidated,
      sharedContactLeads,
      invalidatedSharedLeads,
      reason,
      errors: [...errors, errorMessage],
      executionTime,
      completedAt: new Date().toISOString()
    };

    return result;
  }
}

/**
 * Helper function to check if lead has alternative contact methods
 * Returns true if lead has other ways to be contacted besides the failed method
 */
function hasAlternativeContact(lead: any, options: LeadInvalidationOptions): boolean {
  const failedEmail = options.email;
  const failedPhone = options.telephone;
  
  // Check if lead has email that's different from failed email
  const hasValidEmail = lead.email && 
                       lead.email.trim() !== '' && 
                       (!failedEmail || lead.email !== failedEmail);
  
  // Check if lead has phone that's different from failed phone
  const hasValidPhone = lead.phone && 
                       lead.phone.trim() !== '' && 
                       (!failedPhone || lead.phone !== failedPhone);
  
  console.log(`📋 Alternative contact check for lead ${lead.id}:`);
  console.log(`   - Has valid email: ${hasValidEmail} (current: ${lead.email}, failed: ${failedEmail})`);
  console.log(`   - Has valid phone: ${hasValidPhone} (current: ${lead.phone}, failed: ${failedPhone})`);
  
  return hasValidEmail || hasValidPhone;
} 