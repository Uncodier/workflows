import { proxyActivities, workflowInfo, upsertSearchAttributes } from '@temporalio/workflow';
import type { Activities } from '../activities';

// Import specific daily prospection activities
const {
  validateCommunicationChannelsActivity,
  getProspectionLeadsActivity,
  updateLeadProspectionStatusActivity,
  sendLeadsToSalesAgentActivity,
  assignPriorityLeadsActivity,
} = proxyActivities<{
  validateCommunicationChannelsActivity: (options: any) => Promise<any>;
  getProspectionLeadsActivity: (options: any) => Promise<any>;
  updateLeadProspectionStatusActivity: (options: any) => Promise<any>;
  sendLeadsToSalesAgentActivity: (options: any) => Promise<any>;
  assignPriorityLeadsActivity: (options: any) => Promise<any>;
}>({
  startToCloseTimeout: '10 minutes', // Longer timeout for prospection processes
  retry: {
    maximumAttempts: 3,
  },
});

// Import general activities
const { 
  logWorkflowExecutionActivity,
  saveCronStatusActivity,
  getSiteActivity,
  getSettingsActivity,
  startLeadFollowUpWorkflowActivity,
  validateAndCleanStuckCronStatusActivity,
  validateWorkflowConfigActivity,
  countPendingMessagesActivity,
} = proxyActivities<Activities>({
  startToCloseTimeout: '5 minutes',
  retry: {
    maximumAttempts: 3,
  },
});

export interface DailyProspectionOptions {
  site_id: string;                    // Required: Site ID
  userId?: string;
  hoursThreshold?: number;           // Default 48 hours
  maxLeads?: number;                 // Limit number of leads to process
  updateStatus?: boolean;            // Default false - whether to update lead status
  maxPages?: number;                 // Maximum pages to search (default 10 to prevent infinite loops)
  minLeadsRequired?: number;         // Minimum leads required to stop pagination (default 30)
  additionalData?: any;
}

export interface ProspectionResult {
  lead: any;
  taskCreated: boolean;
  taskId?: string;
  statusUpdated: boolean;
  errors: string[];
}

export interface DailyProspectionResult {
  success: boolean;
  siteId: string;
  siteName?: string;
  siteUrl?: string;
  prospectionCriteria?: {
    status: string;
    hoursThreshold: number;
    createdBefore: string;
    pagesSearched?: number;
    totalCandidatesInDB?: number;
  };
  leadsFound: number;
  leadsProcessed: number;
  tasksCreated: number;
  statusUpdated: number;
  prospectionResults: ProspectionResult[];
  salesAgentResponse?: any;
  selectedLeads?: any[];
  leadsPriority?: any;
  assignedLeads?: any[];
  notificationResults?: any[];
  // New fields for follow-up workflows
  followUpWorkflowsStarted?: number;
  followUpResults?: any[];
  unassignedLeads?: any[];
  // New fields for channel filtering
  leadsFiltered?: number;
  filteredLeads?: any[];
  channelFilteringInfo?: {
    hasEmailChannel: boolean;
    hasWhatsappChannel: boolean;
    leadsWithEmail: number;
    leadsWithPhone: number;
    leadsWithBoth: number;
    leadsWithNeither: number;
    leadsFilteredOut: number;
  };
  // New fields for pagination
  paginationInfo?: {
    totalPagesSearched: number;
    maxPagesConfigured: number;
    minLeadsRequired: number;
    stoppedReason: 'found_leads' | 'max_pages_reached' | 'no_more_pages';
    paginationLog: string[];
  };
  errors: string[];
  executionTime: string;
  completedAt: string;
}

/**
 * Filter leads based on available communication channels
 * Only includes leads that have contact info compatible with enabled channels
 */
/**
 * Extract the real schedule ID from workflow info or parent schedule
 * Prioritizes parent schedule ID over workflow's own schedule attributes
 */
function extractScheduleId(info: any, options: DailyProspectionOptions): string {
  // First, check if a parent schedule ID was passed through additionalData
  // This is the case when launched by dailyOperationsWorkflow
  const parentScheduleId = options.additionalData?.parentScheduleId || 
                          options.additionalData?.originalScheduleId ||
                          options.additionalData?.dailyOperationsScheduleId;
  
  if (parentScheduleId) {
    console.log(`✅ Using parent schedule ID: ${parentScheduleId} (from dailyOperations)`);
    return parentScheduleId;
  }
  
  // Fallback: Check if workflow was triggered by its own schedule
  // Temporal schedules typically set search attributes or memo data
  const searchAttributes = info.searchAttributes || {};
  const memo = info.memo || {};
  
  // Look for common schedule-related attributes
  const scheduleId = 
    searchAttributes['TemporalScheduledById'] || 
    searchAttributes['ScheduleId'] ||
    memo['TemporalScheduledById'] ||
    memo['scheduleId'] ||
    memo['scheduleName'];
    
  if (scheduleId) {
    console.log(`✅ Real schedule ID found: ${scheduleId}`);
    return scheduleId;
  }
  
  // If no schedule ID found, it might be a manual execution or child workflow
  console.log(`⚠️ No schedule ID found in workflow info - likely manual execution or child workflow`);
  return 'manual-execution';
}

function filterLeadsByAvailableChannels(
  leads: any[], 
  channelsValidation: any
): { 
  filteredLeads: any[]; 
  filteringInfo: any; 
  warnings: string[] 
} {
  const { hasEmailChannel, hasWhatsappChannel } = channelsValidation;
  const warnings: string[] = [];
  
  if (!hasEmailChannel && !hasWhatsappChannel) {
    return {
      filteredLeads: [],
      filteringInfo: {
        hasEmailChannel: false,
        hasWhatsappChannel: false,
        leadsWithEmail: 0,
        leadsWithPhone: 0,
        leadsWithBoth: 0,
        leadsWithNeither: 0,
        leadsFilteredOut: leads.length
      },
      warnings: ['No communication channels available - all leads filtered out']
    };
  }

  let leadsWithEmail = 0;
  let leadsWithPhone = 0;
  let leadsWithBoth = 0;
  let leadsWithNeither = 0;
  let leadsFilteredOut = 0;

  const filteredLeads = leads.filter((lead) => {
    const hasEmail = lead.email && typeof lead.email === 'string' && lead.email.trim() !== '';
    const hasPhone = lead.phone && typeof lead.phone === 'string' && lead.phone.trim() !== '';
    
    // Count contact info types
    if (hasEmail && hasPhone) {
      leadsWithBoth++;
    } else if (hasEmail) {
      leadsWithEmail++;
    } else if (hasPhone) {
      leadsWithPhone++;
    } else {
      leadsWithNeither++;
    }

    // Filter logic: lead must have at least one channel that matches site's enabled channels
    const canContactViaEmail = hasEmail && hasEmailChannel;
    const canContactViaWhatsapp = hasPhone && hasWhatsappChannel;
    
    const shouldInclude = canContactViaEmail || canContactViaWhatsapp;
    
    if (!shouldInclude) {
      leadsFilteredOut++;
      const contactInfo = [];
      if (hasEmail) contactInfo.push('email');
      if (hasPhone) contactInfo.push('phone');
      if (contactInfo.length === 0) contactInfo.push('no contact info');
      
      console.log(`🚫 Filtering out lead ${lead.name || lead.email || lead.id}: has ${contactInfo.join(' & ')} but site only supports ${hasEmailChannel ? 'email' : ''}${hasEmailChannel && hasWhatsappChannel ? ' & ' : ''}${hasWhatsappChannel ? 'WhatsApp' : ''}`);
    }
    
    return shouldInclude;
  });

  const filteringInfo = {
    hasEmailChannel,
    hasWhatsappChannel,
    leadsWithEmail,
    leadsWithPhone,
    leadsWithBoth,
    leadsWithNeither,
    leadsFilteredOut
  };

  // Add warnings for common filtering scenarios
  if (leadsFilteredOut > 0) {
    warnings.push(`${leadsFilteredOut} lead(s) filtered out due to incompatible contact channels`);
  }
  
  if (leadsWithNeither > 0) {
    warnings.push(`${leadsWithNeither} lead(s) had no contact information (email or phone)`);
  }
  
  if (!hasEmailChannel && leadsWithEmail > 0) {
    warnings.push(`${leadsWithEmail} lead(s) had email but email channel is not enabled`);
  }
  
  if (!hasWhatsappChannel && leadsWithPhone > 0) {
    warnings.push(`${leadsWithPhone} lead(s) had phone but WhatsApp channel is not enabled`);
  }

  return { filteredLeads, filteringInfo, warnings };
}

/**
 * Auxiliary function to handle paginated lead prospection
 * Continues searching through pages until at least minLeadsRequired leads are found
 * 
 * @param options - Base prospection options
 * @param maxPages - Maximum pages to search 
 * @param minLeadsRequired - Minimum leads required to stop pagination
 * @param channelsValidation - Validation results for communication channels
 * @param site - Site information
 * @returns Combined leads from all pages searched and pagination info
 */
async function searchLeadsWithPagination(
  options: DailyProspectionOptions,
  maxPages: number,
  minLeadsRequired: number,
  channelsValidation: any,
  site: any
): Promise<{
  allLeads: any[];
  totalPagesSearched: number;
  totalCandidatesFound: number;
  stopped: 'found_leads' | 'max_pages_reached' | 'no_more_pages';
  paginationLog: string[];
}> {
  const { site_id, hoursThreshold } = options;
  const allLeads: any[] = [];
  const paginationLog: string[] = [];
  let currentPage = 0;
  let totalCandidatesFound = 0;
  let hasMorePages = true;
  
  console.log(`🔄 Starting paginated lead search:`);
  console.log(`   - Max pages to search: ${maxPages}`);
  console.log(`   - Min leads required: ${minLeadsRequired}`);
  console.log(`   - Page size: 30 leads per page`);
  
  while (currentPage < maxPages && hasMorePages && allLeads.length < minLeadsRequired) {
    console.log(`📄 Searching page ${currentPage}...`);
    paginationLog.push(`Page ${currentPage}: Searching...`);
    
    try {
      const prospectionLeadsResult = await getProspectionLeadsActivity({
        site_id: site_id,
        userId: options.userId || site.user_id,
        hoursThreshold: hoursThreshold,
        page: currentPage,
        pageSize: 30,
        additionalData: {
          siteName: site.name,
          siteUrl: site.url,
          workflowType: 'dailyProspection'
        }
      });
      
      if (!prospectionLeadsResult.success) {
        const errorMsg = `Failed to get prospection leads on page ${currentPage}: ${prospectionLeadsResult.error}`;
        console.error(`❌ ${errorMsg}`);
        paginationLog.push(`Page ${currentPage}: ERROR - ${prospectionLeadsResult.error}`);
        throw new Error(errorMsg);
      }
      
      const rawLeads = prospectionLeadsResult.leads || [];
      hasMorePages = prospectionLeadsResult.hasMorePages || false;
      totalCandidatesFound = prospectionLeadsResult.totalCandidatesFound || 0;
      
      console.log(`📋 Page ${currentPage} results:`);
      console.log(`   - Raw leads found: ${rawLeads.length}`);
      console.log(`   - Has more pages: ${hasMorePages}`);
      console.log(`   - Total candidates in DB: ${totalCandidatesFound}`);
      
      // Apply channel filtering
      const { filteredLeads, warnings } = filterLeadsByAvailableChannels(
        rawLeads, 
        channelsValidation
      );
      
      console.log(`📊 Page ${currentPage} after channel filtering:`);
      console.log(`   - Leads after filtering: ${filteredLeads.length}`);
      console.log(`   - Leads filtered out: ${rawLeads.length - filteredLeads.length}`);
      
      // Add filtered leads to our collection
      allLeads.push(...filteredLeads);
      
      const pageLog = `Page ${currentPage}: Found ${rawLeads.length} raw, ${filteredLeads.length} after filtering. Total so far: ${allLeads.length}`;
      paginationLog.push(pageLog);
      console.log(`📄 ${pageLog}`);
      
      // Add filtering warnings to log
      warnings.forEach(warning => {
        const warningLog = `Page ${currentPage} warning: ${warning}`;
        paginationLog.push(warningLog);
        console.log(`⚠️ ${warningLog}`);
      });
      
      currentPage++;
      
      // Check if we found enough leads
      if (allLeads.length >= minLeadsRequired) {
        const successLog = `✅ Found ${allLeads.length} leads (>= ${minLeadsRequired} required) after searching ${currentPage} page(s)`;
        console.log(successLog);
        paginationLog.push(successLog);
        return {
          allLeads,
          totalPagesSearched: currentPage,
          totalCandidatesFound,
          stopped: 'found_leads',
          paginationLog
        };
      }
      
      // Check if no more pages available
      if (!hasMorePages) {
        const endLog = `📄 No more pages available. Found ${allLeads.length} total leads after searching ${currentPage} page(s)`;
        console.log(endLog);
        paginationLog.push(endLog);
        return {
          allLeads,
          totalPagesSearched: currentPage,
          totalCandidatesFound,
          stopped: 'no_more_pages',
          paginationLog
        };
      }
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorLog = `❌ Error on page ${currentPage}: ${errorMessage}`;
      console.error(errorLog);
      paginationLog.push(errorLog);
      throw error;
    }
  }
  
  // Reached max pages without finding enough leads
  const maxPagesLog = `🛑 Reached maximum pages limit (${maxPages}). Found ${allLeads.length} total leads after searching ${currentPage} page(s)`;
  console.log(maxPagesLog);
  paginationLog.push(maxPagesLog);
  
  return {
    allLeads,
    totalPagesSearched: currentPage,
    totalCandidatesFound,
    stopped: 'max_pages_reached',
    paginationLog
  };
}

/**
 * Daily Prospection Workflow
 * 
 * Este workflow ejecuta la prospección diaria:
 * 1. Busca leads de más de 48 horas con status 'new' sin tasks en 'awareness'
 * 2. Para cada lead encontrado, crea una tarea de awareness
 * 3. Opcionalmente actualiza el status del lead
 * 4. Retorna estadísticas del proceso
 * 5. NUEVO: Incluye paginación para continuar buscando hasta encontrar leads válidos
 * 
 * @param options - Configuration options for daily prospection
 */
export async function dailyProspectionWorkflow(
  options: DailyProspectionOptions
): Promise<DailyProspectionResult> {
  const { 
    site_id, 
    hoursThreshold = 48, 
    maxLeads = 100, 
    updateStatus = false,
    maxPages = 10,
    minLeadsRequired = 30
  } = options;
  
  if (!site_id) {
    throw new Error('No site ID provided');
  }

  const searchAttributes: Record<string, string[]> = {
    site_id: [site_id],
  };
  if (options.userId) {
    searchAttributes.user_id = [options.userId];
  }
  upsertSearchAttributes(searchAttributes);
  
  // Get REAL workflow information from Temporal
  const workflowInfo_real = workflowInfo();
  const realWorkflowId = workflowInfo_real.workflowId;
  const realScheduleId = extractScheduleId(workflowInfo_real, options);
  const startTime = Date.now();
  
  console.log(`🎯 Starting daily prospection workflow for site ${site_id}`);
  console.log(`📋 Options:`, JSON.stringify(options, null, 2));
  console.log(`📋 REAL Workflow ID: ${realWorkflowId} (from Temporal)`);
  console.log(`📋 REAL Schedule ID: ${realScheduleId} (from ${realScheduleId === 'manual-execution' ? 'manual execution' : 'schedule'})`);

  // Validate and clean any stuck cron status records before execution
  console.log('🔍 Validating cron status before daily prospection execution...');
  
  const cronValidation = await validateAndCleanStuckCronStatusActivity(
    'dailyProspectionWorkflow',
    site_id,
    24 // 24 hours threshold - daily prospection should not be stuck longer than 24h
  );
  
  console.log(`📋 Cron validation result: ${cronValidation.reason}`);
  if (cronValidation.wasStuck) {
    console.log(`🧹 Cleaned stuck record that was ${cronValidation.hoursStuck?.toFixed(1)}h old`);
  }
  
  if (!cronValidation.canProceed) {
    console.log('⏳ Another daily prospection is likely running for this site - terminating');
    
    // Log termination
    await logWorkflowExecutionActivity({
      workflowId: realWorkflowId,
      workflowType: 'dailyProspectionWorkflow',
      status: 'BLOCKED',
      input: options,
      error: `Workflow blocked: ${cronValidation.reason}`,
    });

    throw new Error(`Workflow blocked: ${cronValidation.reason}`);
  }

  // STEP 0: Validate workflow configuration
  console.log('🔐 Step 0: Validating workflow configuration...');
  const configValidation = await validateWorkflowConfigActivity(
    site_id,
    'leads_initial_cold_outreach'
  );
  
  if (!configValidation.shouldExecute) {
    console.log(`⛔ Workflow execution blocked: ${configValidation.reason}`);
    
    // Log blocked execution
    await logWorkflowExecutionActivity({
      workflowId: realWorkflowId,
      workflowType: 'dailyProspectionWorkflow',
      status: 'BLOCKED',
      input: options,
      error: `Workflow is ${configValidation.activityStatus} in site settings`,
    });

    return {
      success: false,
      siteId: site_id,
      leadsFound: 0,
      leadsProcessed: 0,
      tasksCreated: 0,
      statusUpdated: 0,
      prospectionResults: [],
      errors: [`Workflow is ${configValidation.activityStatus} in site settings`],
      executionTime: `${Date.now() - startTime}ms`,
      completedAt: new Date().toISOString(),
    };
  }
  
  console.log(`✅ Configuration validated: ${configValidation.reason}`);

  // Log workflow execution start
  await logWorkflowExecutionActivity({
    workflowId: realWorkflowId,
    workflowType: 'dailyProspectionWorkflow',
    status: 'STARTED',
    input: options,
  });

  // Update cron status to indicate the workflow is running
  await saveCronStatusActivity({
    siteId: site_id,
    workflowId: realWorkflowId,
    scheduleId: realScheduleId,
    activityName: 'dailyProspectionWorkflow',
    status: 'RUNNING',
    lastRun: new Date().toISOString()
  });

  const errors: string[] = [];
  const prospectionResults: ProspectionResult[] = [];
  let leadsFound = 0;
  let leadsProcessed = 0;
  const tasksCreated = 0;
  let statusUpdated = 0;
  let prospectionCriteria: any = null;
  let siteName = '';
  let siteUrl = '';
  let salesAgentResponse: any = null;
  let selectedLeads: any[] = [];
  let leadsPriority: any = null;
  let assignedLeads: any[] = [];
  let notificationResults: any[] = [];
  // Channel filtering variables
  let leadsFiltered = 0;
  let leads: any[] = [];
  let filteringInfo: any = {
    hasEmailChannel: false,
    hasWhatsappChannel: false,
    leadsWithEmail: 0,
    leadsWithPhone: 0,
    leadsWithBoth: 0,
    leadsWithNeither: 0,
    leadsFilteredOut: 0
  };

  try {
    console.log(`📡 Step 0: Validating communication channels for ${site_id}...`);
    
    // Validate that the site has email or WhatsApp channels configured
    const channelsValidation = await validateCommunicationChannelsActivity({
      site_id: site_id
    });
    
    if (!channelsValidation.success) {
      const errorMsg = `Failed to validate communication channels: ${channelsValidation.error}`;
      console.error(`❌ ${errorMsg}`);
      errors.push(errorMsg);
      throw new Error(errorMsg);
    }
    
    if (!channelsValidation.hasAnyChannel) {
      const errorMsg = `No communication channels (email or WhatsApp) are configured and enabled for site ${site_id}. Prospection requires at least one communication channel to send follow-up messages.`;
      console.error(`❌ ${errorMsg}`);
      errors.push(errorMsg);
      
      // Return early failure instead of throwing to provide detailed information
      const result: DailyProspectionResult = {
        success: false,
        siteId: site_id,
        siteName: '',
        siteUrl: '',
        prospectionCriteria: undefined,
        leadsFound: 0,
        leadsProcessed: 0,
        tasksCreated: 0,
        statusUpdated: 0,
        prospectionResults: [],
        salesAgentResponse: null,
        selectedLeads: [],
        leadsPriority: null,
        assignedLeads: [],
        notificationResults: [],
        followUpWorkflowsStarted: 0,
        followUpResults: [],
        unassignedLeads: [],
        errors: [errorMsg],
        executionTime: `${((Date.now() - startTime) / 1000).toFixed(2)}s`,
        completedAt: new Date().toISOString()
      };
      
      // Update cron status to indicate validation failure
      await saveCronStatusActivity({
        siteId: site_id,
        workflowId: realWorkflowId,
        scheduleId: realScheduleId,
        activityName: 'dailyProspectionWorkflow',
        status: 'FAILED',
        lastRun: new Date().toISOString(),
        errorMessage: errorMsg,
        retryCount: 1
      });
      
      // Log workflow execution failure
      await logWorkflowExecutionActivity({
        workflowId: realWorkflowId,
        workflowType: 'dailyProspectionWorkflow',
        status: 'FAILED',
        input: options,
        error: errorMsg,
      });
      
      return result;
    }
    
    console.log(`✅ Communication channels validated successfully:`);
    console.log(`   - Email channel: ${channelsValidation.hasEmailChannel ? 'Available' : 'Not configured'}`);
    console.log(`   - WhatsApp channel: ${channelsValidation.hasWhatsappChannel ? 'Available' : 'Not configured'}`);

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

    // Fetch settings to check if lead assignment is enabled
    console.log(`⚙️ Step 1.5: Fetching settings for ${site_id}...`);
    const settingsResult = await getSettingsActivity(site_id);
    let assignLeadsEnabled = false;

    if (settingsResult.success && settingsResult.settings?.activities?.assign_leads_to_team?.status === 'active') {
      assignLeadsEnabled = true;
      console.log(`✅ Lead assignment to team is ENABLED`);
    } else {
      console.log(`⚠️ Lead assignment to team is DISABLED or not configured`);
      if (settingsResult.error) {
        console.log(`   - Settings fetch error: ${settingsResult.error}`);
      } else if (!settingsResult.settings?.activities?.assign_leads_to_team) {
        console.log(`   - assign_leads_to_team not declared in settings`);
      } else {
        console.log(`   - assign_leads_to_team.status = ${settingsResult.settings?.activities?.assign_leads_to_team?.status || 'undefined'}`);
      }
    }

    console.log(`🔍 Step 2: Getting prospection leads with pagination...`);
    console.log(`📋 Pagination configuration:`);
    console.log(`   - Max pages to search: ${maxPages}`);
    console.log(`   - Min leads required: ${minLeadsRequired}`);
    
    let paginationResults;
    try {
      // Use the new paginated search function
      paginationResults = await searchLeadsWithPagination(
        options,
        maxPages,
        minLeadsRequired,
        channelsValidation,
        site
      );
      
      // Extract results from pagination
      leads = paginationResults.allLeads;
      leadsFound = leads.length; // This is now leads after filtering
      leadsFiltered = leads.length;
      
      console.log(`🎉 Pagination search completed:`);
      console.log(`   - Total pages searched: ${paginationResults.totalPagesSearched}`);
      console.log(`   - Total candidates in DB: ${paginationResults.totalCandidatesFound}`);
      console.log(`   - Final leads after filtering: ${leadsFiltered}`);
      console.log(`   - Stopped reason: ${paginationResults.stopped}`);
      
      // Log detailed pagination information
      console.log(`📄 Pagination log:`);
      paginationResults.paginationLog.forEach((log, index) => {
        console.log(`   ${index + 1}. ${log}`);
      });
      
      // Add pagination info to errors for tracking (these are informational, not actual errors)
      errors.push(`Pagination: Searched ${paginationResults.totalPagesSearched} page(s), found ${leadsFiltered} valid leads`);
      errors.push(`Pagination stopped: ${paginationResults.stopped}`);
      
      // Set mock criteria for compatibility
      prospectionCriteria = {
        site_id,
        status: 'new',
        hoursThreshold,
        createdBefore: new Date(Date.now() - hoursThreshold * 60 * 60 * 1000).toISOString(),
        pagesSearched: paginationResults.totalPagesSearched,
        totalCandidatesInDB: paginationResults.totalCandidatesFound
      };
      
      // Since we already applied filtering in the pagination function, 
      // we just need to set the filtering info for reporting
      filteringInfo = {
        hasEmailChannel: channelsValidation.hasEmailChannel,
        hasWhatsappChannel: channelsValidation.hasWhatsappChannel,
        leadsWithEmail: 0, // These are calculated in the pagination function
        leadsWithPhone: 0,
        leadsWithBoth: 0,
        leadsWithNeither: 0,
        leadsFilteredOut: paginationResults.totalCandidatesFound - leadsFiltered
      };
      
    } catch (paginationError) {
      const errorMsg = paginationError instanceof Error ? paginationError.message : String(paginationError);
      
      // Check for critical 414 errors that should fail the entire workflow
      if (errorMsg.includes('414') || 
          errorMsg.includes('Request-URI Too Large') ||
          errorMsg.includes('<html>') || 
          errorMsg.includes('cloudflare') ||
          errorMsg.includes('HTTP_414') ||
          errorMsg.includes('Server returned HTML error page')) {
        
        const criticalError = `Critical API error (414 Request-URI Too Large) in Paginated Lead Search: ${errorMsg}`;
        console.error(`🚨 CRITICAL ERROR: ${criticalError}`);
        console.error(`🛑 This error requires immediate attention and workflow termination`);
        
        errors.push(criticalError);
        throw new Error(criticalError);
      }
      
      const fullErrorMsg = `Failed to get prospection leads via pagination: ${errorMsg}`;
      console.error(`❌ ${fullErrorMsg}`);
      errors.push(fullErrorMsg);
      throw new Error(fullErrorMsg);
    }

    // Step 2.5: Send leads to sales agent for selection and prioritization
    if (leadsFiltered > 0) {
      console.log(`🎯 Step 2.5: Sending leads to sales agent for selection and prioritization...`);
      
      const salesAgentResult = await sendLeadsToSalesAgentActivity({
        site_id: site_id,
        leads: leads,
        userId: options.userId || site.user_id,
        additionalData: {
          // Only include essential data to avoid 414 errors
          siteName: siteName,
          siteUrl: siteUrl,
          workflowId: realWorkflowId,
          workflowType: 'dailyProspection'
          // Exclude large objects that could cause 414 errors
        }
      });

      if (salesAgentResult.success) {
        salesAgentResponse = salesAgentResult.response;
        selectedLeads = salesAgentResult.selectedLeads || [];
        leadsPriority = salesAgentResult.priority;
        console.log(`✅ Sales agent processed ${leads.length} leads and selected ${selectedLeads.length} for prioritization`);

        // Step 2.6: Assign priority leads based on sales agent response (ONLY if enabled)
        if (assignLeadsEnabled) {
          console.log(`📋 Step 2.6: Assigning priority leads based on sales agent recommendations...`);
          
          const assignmentResult = await assignPriorityLeadsActivity({
            site_id: site_id,
            salesAgentResponse: salesAgentResponse,
            userId: options.userId || site.user_id,
            additionalData: {
              // Only include essential data to avoid 414 errors
              siteName: siteName,
              siteUrl: siteUrl,
              workflowId: realWorkflowId,
              workflowType: 'dailyProspection'
              // Exclude large objects that could cause 414 errors
            }
          });

          if (assignmentResult.success) {
            assignedLeads = assignmentResult.assignedLeads || [];
            notificationResults = assignmentResult.notificationResults || [];
            console.log(`✅ Lead assignment completed: ${assignedLeads.length} leads assigned`);
            console.log(`📧 Notifications sent: ${notificationResults.filter(r => r.success).length}/${notificationResults.length} successful`);
          } else {
            const errorMsg = `Lead assignment failed: ${assignmentResult.error}`;
            console.error(`❌ ${errorMsg}`);
            errors.push(errorMsg);
            console.log(`⚠️ Continuing with prospection despite assignment failure`);
          }
        } else {
          console.log(`⏭️ Step 2.6: SKIPPED - Lead assignment is disabled in settings`);
        }
      } else {
        const errorMsg = String(salesAgentResult.error || 'Unknown error');
        
        // Check for critical 414 errors that should fail the entire workflow
        if (errorMsg.includes('414') || 
            errorMsg.includes('Request-URI Too Large') ||
            errorMsg.includes('<html>') || 
            errorMsg.includes('cloudflare') ||
            errorMsg.includes('HTTP_414') ||
            errorMsg.includes('Server returned HTML error page')) {
          
          const criticalError = `Critical API error (414 Request-URI Too Large) in Sales Agent API: ${errorMsg}`;
          console.error(`🚨 CRITICAL ERROR: ${criticalError}`);
          console.error(`🛑 This error requires immediate attention and workflow termination`);
          
          errors.push(criticalError);
          throw new Error(criticalError);
        }
        
        const fullErrorMsg = `Sales agent processing failed: ${errorMsg}`;
        console.error(`❌ ${fullErrorMsg}`);
        errors.push(fullErrorMsg);
        // Continue with all leads if sales agent fails
        selectedLeads = leads;
        console.log(`⚠️ Continuing with all ${leads.length} leads due to sales agent failure`);
      }
    }
    
    if (leadsFiltered === 0) {
      const reason = leadsFound === 0 ? 'No leads found for prospection' : 'All leads filtered out due to incompatible communication channels';
      console.log(`ℹ️ ${reason} - workflow completed successfully`);
      
      const result: DailyProspectionResult = {
        success: true,
        siteId: site_id,
        siteName,
        siteUrl,
        prospectionCriteria,
        leadsFound,
        leadsProcessed: 0,
        tasksCreated: 0,
        statusUpdated: 0,
        prospectionResults: [],
        salesAgentResponse,
        selectedLeads,
        leadsPriority,
        assignedLeads,
        notificationResults,
        leadsFiltered,
        filteredLeads: leads,
        channelFilteringInfo: filteringInfo,
        paginationInfo: paginationResults ? {
          totalPagesSearched: paginationResults.totalPagesSearched,
          maxPagesConfigured: maxPages,
          minLeadsRequired: minLeadsRequired,
          stoppedReason: paginationResults.stopped,
          paginationLog: paginationResults.paginationLog
        } : undefined,
        errors,
        executionTime: `${((Date.now() - startTime) / 1000).toFixed(2)}s`,
        completedAt: new Date().toISOString()
      };
      
      // Update cron status to indicate successful completion
      await saveCronStatusActivity({
        siteId: site_id,
        workflowId: realWorkflowId,
        scheduleId: realScheduleId,
        activityName: 'dailyProspectionWorkflow',
        status: 'COMPLETED',
        lastRun: new Date().toISOString()
      });
      
      // Log successful completion
      await logWorkflowExecutionActivity({
        workflowId: realWorkflowId,
        workflowType: 'dailyProspectionWorkflow',
        status: 'COMPLETED',
        input: options,
        output: result,
      });
      
      return result;
    }

    // Use selected leads from sales agent, or fall back to all leads if no selection
    const leadsToSelect = selectedLeads.length > 0 ? selectedLeads : leads;
    
    // Limit the number of leads to process if specified
    const leadsToProcess = maxLeads ? leadsToSelect.slice(0, maxLeads) : leadsToSelect;
    leadsProcessed = leadsToProcess.length;
    
    if (maxLeads && leadsToSelect.length > maxLeads) {
      console.log(`⚠️ Processing only first ${maxLeads} leads out of ${leadsToSelect.length} selected by sales agent`);
      errors.push(`Limited processing to ${maxLeads} leads (${leadsToSelect.length} total selected)`);
    }

    console.log(`👥 Step 3: Processing ${leadsProcessed} leads for prospection...`);
    console.log(`   - Total leads found: ${leadsFound}`);
    console.log(`   - Selected by sales agent: ${selectedLeads.length}`);
    console.log(`   - Final leads to process: ${leadsProcessed}`);
    
    // Process each lead
    for (let i = 0; i < leadsToProcess.length; i++) {
      const lead = leadsToProcess[i];
      console.log(`🏢 Processing lead ${i + 1}/${leadsToProcess.length}: ${lead.name || lead.email}`);
      
      const prospectionResult: ProspectionResult = {
        lead: lead,
        taskCreated: false,
        statusUpdated: false,
        errors: []
      };
      
      try {
        // Step 3a: Task creation is disabled for this workflow
        console.log(`ℹ️ Processing lead for prospection: ${lead.name || lead.email}`);
        prospectionResult.taskCreated = false;
        
        // Step 3b: Optionally update lead status
        if (updateStatus) {
          console.log(`📝 Step 3b: Updating lead status for: ${lead.name || lead.email}`);
          
          const updateStatusResult = await updateLeadProspectionStatusActivity({
            lead_id: lead.id,
            site_id: site_id,
            newStatus: 'contacted',
            userId: options.userId || site.user_id,
            notes: `Lead incluido en prospección diaria`
          });
          
          if (updateStatusResult.success) {
            prospectionResult.statusUpdated = true;
            statusUpdated++;
            console.log(`✅ Successfully updated status for ${lead.name || lead.email}`);
          } else {
            const errorMsg = `Failed to update status for ${lead.name || lead.email}: ${updateStatusResult.error}`;
            console.error(`❌ ${errorMsg}`);
            prospectionResult.errors.push(errorMsg);
          }
        } else {
          console.log(`ℹ️ Skipping status update (updateStatus=false) for ${lead.name || lead.email}`);
        }
        
      } catch (leadError) {
        const errorMessage = leadError instanceof Error ? leadError.message : String(leadError);
        console.error(`❌ Error processing lead ${lead.name || lead.email}: ${errorMessage}`);
        prospectionResult.errors.push(errorMessage);
      }
      
      prospectionResults.push(prospectionResult);
      console.log(`📊 Completed processing lead ${i + 1}/${leadsToProcess.length}: ${lead.name || lead.email}`);
    }

    const executionTime = `${((Date.now() - startTime) / 1000).toFixed(2)}s`;
    
    const result: DailyProspectionResult = {
      success: true,
      siteId: site_id,
      siteName,
      siteUrl,
      prospectionCriteria,
      leadsFound,
      leadsProcessed,
      tasksCreated,
      statusUpdated,
      prospectionResults,
      salesAgentResponse,
      selectedLeads,
      leadsPriority,
      assignedLeads,
      notificationResults,
      leadsFiltered,
      filteredLeads: leads,
      channelFilteringInfo: filteringInfo,
      paginationInfo: paginationResults ? {
        totalPagesSearched: paginationResults.totalPagesSearched,
        maxPagesConfigured: maxPages,
        minLeadsRequired: minLeadsRequired,
        stoppedReason: paginationResults.stopped,
        paginationLog: paginationResults.paginationLog
      } : undefined,
      errors,
      executionTime,
      completedAt: new Date().toISOString()
    };

    // Step 7: Start follow-up workflows for leads not assigned to humans
    console.log(`🔄 Step 7: Starting follow-up workflows for unassigned leads...`);
    
    // Step 7.1: Check pending messages count before queuing new follow-ups
    console.log(`🔍 Step 7.1: Checking pending messages count for queue throttling...`);
    
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
        
        // Update result to indicate queue was throttled
        result.followUpWorkflowsStarted = 0;
        result.followUpResults = [];
        result.unassignedLeads = [];
        
        console.log(`🎉 Daily prospection workflow completed (queue throttled)!`);
        console.log(`📊 Summary: Daily prospection for site ${siteName} completed in ${executionTime}`);
        console.log(`   - Site: ${siteName} (${siteUrl})`);
        console.log(`   - Leads found: ${leadsFound}`);
        console.log(`   - Leads after channel filtering: ${leadsFiltered} (${leadsFound - leadsFiltered} filtered out)`);
        console.log(`   - Leads processed: ${leadsProcessed}`);
        console.log(`   - Queue throttled: ${pendingCount} pending messages (>= 100)`);
        console.log(`   - Follow-up workflows skipped due to queue throttling`);
        
        // Update cron status to indicate successful completion
        await saveCronStatusActivity({
          siteId: site_id,
          workflowId: realWorkflowId,
          scheduleId: realScheduleId,
          activityName: 'dailyProspectionWorkflow',
          status: 'COMPLETED',
          lastRun: new Date().toISOString()
        });

        // Log successful completion
        await logWorkflowExecutionActivity({
          workflowId: realWorkflowId,
          workflowType: 'dailyProspectionWorkflow',
          status: 'COMPLETED',
          input: options,
          output: result,
        });

        return result;
      } else {
        console.log(`✅ Pending messages count (${pendingCount}) is below threshold (100) - proceeding with follow-up workflows`);
      }
    }
    
    // Identify leads that were NOT assigned to humans
    const assignedLeadIds = assignedLeads.map((lead: any) => lead.id || lead.lead_id);
    const unassignedLeads = leadsToProcess.filter((lead: any) => !assignedLeadIds.includes(lead.id));
    
    console.log(`📊 Follow-up analysis:`);
    console.log(`   - Total leads processed: ${leadsToProcess.length}`);
    console.log(`   - Leads assigned to humans: ${assignedLeads.length}`);
    console.log(`   - Leads requiring follow-up: ${unassignedLeads.length}`);
    
    const followUpResults: any[] = [];
    let followUpWorkflowsStarted = 0;
    
    if (unassignedLeads.length > 0) {
      console.log(`🚀 Starting lead follow-up workflows for ${unassignedLeads.length} unassigned leads...`);
      
      for (const lead of unassignedLeads) {
        try {
          console.log(`📞 Starting follow-up workflow for lead: ${lead.name || lead.email} (ID: ${lead.id})`);
          
          const followUpResult = await startLeadFollowUpWorkflowActivity({
            lead_id: lead.id,
            site_id: site_id,
            userId: options.userId || site.user_id,
            additionalData: {
              triggeredBy: 'dailyProspectionWorkflow',
              reason: 'lead_not_assigned_to_human',
              prospectionDate: new Date().toISOString(),
              originalWorkflowId: realWorkflowId,
              leadInfo: {
                name: lead.name,
                email: lead.email,
                company: lead.company
              }
            }
          });
          
          if (followUpResult.success) {
            followUpWorkflowsStarted++;
            console.log(`✅ Follow-up workflow started for ${lead.name || lead.email}: ${followUpResult.workflowId}`);
            followUpResults.push({
              lead_id: lead.id,
              lead_name: lead.name || lead.email,
              success: true,
              workflowId: followUpResult.workflowId
            });
          } else {
            const errorMsg = `Failed to start follow-up workflow for ${lead.name || lead.email}: ${followUpResult.error}`;
            console.error(`❌ ${errorMsg}`);
            errors.push(errorMsg);
            followUpResults.push({
              lead_id: lead.id,
              lead_name: lead.name || lead.email,
              success: false,
              error: followUpResult.error
            });
          }
          
        } catch (followUpError) {
          const errorMessage = followUpError instanceof Error ? followUpError.message : String(followUpError);
          const errorMsg = `Exception starting follow-up workflow for ${lead.name || lead.email}: ${errorMessage}`;
          console.error(`❌ ${errorMsg}`);
          errors.push(errorMsg);
          followUpResults.push({
            lead_id: lead.id,
            lead_name: lead.name || lead.email,
            success: false,
            error: errorMessage
          });
        }
      }
      
      console.log(`✅ Follow-up workflows completed: ${followUpWorkflowsStarted}/${unassignedLeads.length} started successfully`);
    } else {
      console.log(`ℹ️ No follow-up workflows needed (all leads were assigned to humans or no leads processed)`);
    }
    
    // Update result with follow-up information
    result.followUpWorkflowsStarted = followUpWorkflowsStarted;
    result.followUpResults = followUpResults;
    result.unassignedLeads = unassignedLeads;

    console.log(`🎉 Daily prospection workflow completed successfully!`);
    console.log(`📊 Summary: Daily prospection for site ${siteName} completed in ${executionTime}`);
    console.log(`   - Site: ${siteName} (${siteUrl})`);
    console.log(`   - Leads found: ${leadsFound}`);
    console.log(`   - Leads after channel filtering: ${leadsFiltered} (${leadsFound - leadsFiltered} filtered out)`);
    console.log(`   - Leads processed: ${leadsProcessed}`);
    console.log(`   - Tasks created: ${tasksCreated}`);
    console.log(`   - Status updated: ${statusUpdated}`);
    console.log(`   - Leads assigned: ${assignedLeads.length}`);
    console.log(`   - Notifications sent: ${notificationResults.filter(r => r.success).length}/${notificationResults.length}`);
    console.log(`   - Follow-up workflows started: ${followUpWorkflowsStarted}/${unassignedLeads.length}`);
    console.log(`   - Unassigned leads (auto follow-up): ${unassignedLeads.length}`);
    if (paginationResults) {
      console.log(`   - Pagination: Searched ${paginationResults.totalPagesSearched} page(s), stopped: ${paginationResults.stopped}`);
      console.log(`   - Total candidates in DB: ${paginationResults.totalCandidatesFound}`);
    }
    
    if (errors.length > 0) {
      console.log(`   - Errors encountered: ${errors.length}`);
      errors.forEach((error, index) => {
        console.log(`     ${index + 1}. ${error}`);
      });
    }

    // Update cron status to indicate successful completion
    await saveCronStatusActivity({
      siteId: site_id,
      workflowId: realWorkflowId,
      scheduleId: realScheduleId,
      activityName: 'dailyProspectionWorkflow',
      status: 'COMPLETED',
      lastRun: new Date().toISOString()
    });

    // Log successful completion
    await logWorkflowExecutionActivity({
      workflowId: realWorkflowId,
      workflowType: 'dailyProspectionWorkflow',
      status: 'COMPLETED',
      input: options,
      output: result,
    });

    return result;

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Daily prospection workflow failed: ${errorMessage}`);
    
    // Update cron status to indicate failure
    await saveCronStatusActivity({
      siteId: site_id,
      workflowId: realWorkflowId,
      scheduleId: realScheduleId,
      activityName: 'dailyProspectionWorkflow',
      status: 'FAILED',
      lastRun: new Date().toISOString(),
      errorMessage: errorMessage,
      retryCount: 1
    });

    // Log workflow execution failure
    await logWorkflowExecutionActivity({
      workflowId: realWorkflowId,
      workflowType: 'dailyProspectionWorkflow',
      status: 'FAILED',
      input: options,
      error: errorMessage,
    });

    // Throw error to properly fail the workflow
    throw new Error(`Daily prospection workflow failed: ${errorMessage}`);
  }
}