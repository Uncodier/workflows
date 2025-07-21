import { proxyActivities } from '@temporalio/workflow';
import type { Activities } from '../activities';

// Import specific daily prospection activities
const {
  validateCommunicationChannelsActivity,
  getProspectionLeadsActivity,
  createAwarenessTaskActivity,
  updateLeadProspectionStatusActivity,
  sendLeadsToSalesAgentActivity,
  assignPriorityLeadsActivity,
} = proxyActivities<{
  validateCommunicationChannelsActivity: (options: any) => Promise<any>;
  getProspectionLeadsActivity: (options: any) => Promise<any>;
  createAwarenessTaskActivity: (options: any) => Promise<any>;
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
  startLeadFollowUpWorkflowActivity,
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
  createTasks?: boolean;             // Default true to create tasks, set false for validation only
  updateStatus?: boolean;            // Default false - whether to update lead status
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
  errors: string[];
  executionTime: string;
  completedAt: string;
}

/**
 * Daily Prospection Workflow
 * 
 * Este workflow ejecuta la prospección diaria:
 * 1. Busca leads de más de 48 horas con status 'new' sin tasks en 'awareness'
 * 2. Para cada lead encontrado, crea una tarea de awareness
 * 3. Opcionalmente actualiza el status del lead
 * 4. Retorna estadísticas del proceso
 * 
 * @param options - Configuration options for daily prospection
 */
export async function dailyProspectionWorkflow(
  options: DailyProspectionOptions
): Promise<DailyProspectionResult> {
  const { site_id, hoursThreshold = 48, maxLeads = 50, createTasks = true, updateStatus = false } = options;
  
  if (!site_id) {
    throw new Error('No site ID provided');
  }
  
  const workflowId = `daily-prospection-${site_id}`;
  const startTime = Date.now();
  
  console.log(`🎯 Starting daily prospection workflow for site ${site_id}`);
  console.log(`📋 Options:`, JSON.stringify(options, null, 2));

  // Log workflow execution start
  await logWorkflowExecutionActivity({
    workflowId,
    workflowType: 'dailyProspectionWorkflow',
    status: 'STARTED',
    input: options,
  });

  // Update cron status to indicate the workflow is running
  await saveCronStatusActivity({
    siteId: site_id,
    workflowId,
    scheduleId: `daily-prospection-${site_id}`,
    activityName: 'dailyProspectionWorkflow',
    status: 'RUNNING',
    lastRun: new Date().toISOString()
  });

  const errors: string[] = [];
  const prospectionResults: ProspectionResult[] = [];
  let leadsFound = 0;
  let leadsProcessed = 0;
  let tasksCreated = 0;
  let statusUpdated = 0;
  let prospectionCriteria: any = null;
  let siteName = '';
  let siteUrl = '';
  let salesAgentResponse: any = null;
  let selectedLeads: any[] = [];
  let leadsPriority: any = null;
  let assignedLeads: any[] = [];
  let notificationResults: any[] = [];

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
        workflowId,
        scheduleId: `daily-prospection-${site_id}`,
        activityName: 'dailyProspectionWorkflow',
        status: 'FAILED',
        lastRun: new Date().toISOString(),
        errorMessage: errorMsg,
        retryCount: 1
      });
      
      // Log workflow execution failure
      await logWorkflowExecutionActivity({
        workflowId,
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

    console.log(`🔍 Step 2: Getting prospection leads...`);
    
    // Get leads that need prospection
    const prospectionLeadsResult = await getProspectionLeadsActivity({
      site_id: site_id,
      userId: options.userId || site.user_id,
      hoursThreshold: hoursThreshold,
      additionalData: {
        ...options.additionalData,
        siteName: siteName,
        siteUrl: siteUrl
      }
    });
    
    if (!prospectionLeadsResult.success) {
      const errorMsg = `Failed to get prospection leads: ${prospectionLeadsResult.error}`;
      console.error(`❌ ${errorMsg}`);
      errors.push(errorMsg);
      throw new Error(errorMsg);
    }
    
    const leads = prospectionLeadsResult.leads || [];
    leadsFound = leads.length;
    prospectionCriteria = prospectionLeadsResult.criteria;
    
    console.log(`✅ Found ${leadsFound} leads for prospection`);

    // Step 2.5: Send leads to sales agent for selection and prioritization
    if (leadsFound > 0) {
      console.log(`🎯 Step 2.5: Sending leads to sales agent for selection and prioritization...`);
      
      const salesAgentResult = await sendLeadsToSalesAgentActivity({
        site_id: site_id,
        leads: leads,
        userId: options.userId || site.user_id,
        additionalData: {
          ...options.additionalData,
          siteName: siteName,
          siteUrl: siteUrl,
          workflowId: workflowId
        }
      });

      if (salesAgentResult.success) {
        salesAgentResponse = salesAgentResult.response;
        selectedLeads = salesAgentResult.selectedLeads || [];
        leadsPriority = salesAgentResult.priority;
        console.log(`✅ Sales agent processed ${leads.length} leads and selected ${selectedLeads.length} for prioritization`);

        // Step 2.6: Assign priority leads based on sales agent response
        console.log(`📋 Step 2.6: Assigning priority leads based on sales agent recommendations...`);
        
        const assignmentResult = await assignPriorityLeadsActivity({
          site_id: site_id,
          salesAgentResponse: salesAgentResponse,
          userId: options.userId || site.user_id,
          additionalData: {
            ...options.additionalData,
            siteName: siteName,
            siteUrl: siteUrl,
            workflowId: workflowId
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
        const errorMsg = `Sales agent processing failed: ${salesAgentResult.error}`;
        console.error(`❌ ${errorMsg}`);
        errors.push(errorMsg);
        // Continue with all leads if sales agent fails
        selectedLeads = leads;
        console.log(`⚠️ Continuing with all ${leads.length} leads due to sales agent failure`);
      }
    }
    
    if (leadsFound === 0) {
      console.log(`ℹ️ No leads found for prospection - workflow completed successfully`);
      
      const result: DailyProspectionResult = {
        success: true,
        siteId: site_id,
        siteName,
        siteUrl,
        prospectionCriteria,
        leadsFound: 0,
        leadsProcessed: 0,
        tasksCreated: 0,
        statusUpdated: 0,
        prospectionResults: [],
        salesAgentResponse,
        selectedLeads,
        leadsPriority,
        assignedLeads,
        notificationResults,
        errors,
        executionTime: `${((Date.now() - startTime) / 1000).toFixed(2)}s`,
        completedAt: new Date().toISOString()
      };
      
      // Update cron status to indicate successful completion
      await saveCronStatusActivity({
        siteId: site_id,
        workflowId,
        scheduleId: `daily-prospection-${site_id}`,
        activityName: 'dailyProspectionWorkflow',
        status: 'COMPLETED',
        lastRun: new Date().toISOString()
      });
      
      // Log successful completion
      await logWorkflowExecutionActivity({
        workflowId,
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
        // Step 3a: Create awareness task for this lead
        if (createTasks) {
          console.log(`📝 Step 3a: Creating awareness task for lead: ${lead.name || lead.email}`);
          
          const createTaskResult = await createAwarenessTaskActivity({
            lead_id: lead.id,
            site_id: site_id,
            userId: options.userId || site.user_id,
            title: `Contacto inicial con ${lead.name || lead.email}`,
            description: `Tarea de prospección para establecer primer contacto con el lead ${lead.name || lead.email}`,
            scheduled_date: new Date().toISOString(),
            additionalData: {
              ...options.additionalData,
              workflowId: workflowId,
              prospectionReason: 'daily_prospection_workflow',
              leadAge: Math.floor((new Date().getTime() - new Date(lead.created_at).getTime()) / (1000 * 60 * 60 * 24))
            }
          });
          
          if (createTaskResult.success) {
            prospectionResult.taskCreated = true;
            prospectionResult.taskId = createTaskResult.taskId;
            tasksCreated++;
            console.log(`✅ Successfully created awareness task ${createTaskResult.taskId} for ${lead.name || lead.email}`);
          } else {
            const errorMsg = `Failed to create awareness task for ${lead.name || lead.email}: ${createTaskResult.error}`;
            console.error(`❌ ${errorMsg}`);
            prospectionResult.errors.push(errorMsg);
          }
        } else {
          console.log(`ℹ️ Skipping task creation (createTasks=false) for ${lead.name || lead.email}`);
        }
        
        // Step 3b: Optionally update lead status
        if (updateStatus && prospectionResult.taskCreated) {
          console.log(`📝 Step 3b: Updating lead status for: ${lead.name || lead.email}`);
          
          const updateStatusResult = await updateLeadProspectionStatusActivity({
            lead_id: lead.id,
            site_id: site_id,
            newStatus: 'contacted',
            userId: options.userId || site.user_id,
            notes: `Lead incluido en prospección diaria - tarea de awareness creada`
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
        } else if (updateStatus && !prospectionResult.taskCreated) {
          console.log(`⚠️ Skipping status update for ${lead.name || lead.email} (task not created)`);
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
      errors,
      executionTime,
      completedAt: new Date().toISOString()
    };

    // Step 7: Start follow-up workflows for leads not assigned to humans
    console.log(`🔄 Step 7: Starting follow-up workflows for unassigned leads...`);
    
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
              originalWorkflowId: workflowId,
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
    console.log(`   - Leads processed: ${leadsProcessed}`);
    console.log(`   - Tasks created: ${tasksCreated}`);
    console.log(`   - Status updated: ${statusUpdated}`);
    console.log(`   - Leads assigned: ${assignedLeads.length}`);
    console.log(`   - Notifications sent: ${notificationResults.filter(r => r.success).length}/${notificationResults.length}`);
    console.log(`   - Follow-up workflows started: ${followUpWorkflowsStarted}/${unassignedLeads.length}`);
    console.log(`   - Unassigned leads (auto follow-up): ${unassignedLeads.length}`);
    
    if (errors.length > 0) {
      console.log(`   - Errors encountered: ${errors.length}`);
      errors.forEach((error, index) => {
        console.log(`     ${index + 1}. ${error}`);
      });
    }

    // Update cron status to indicate successful completion
    await saveCronStatusActivity({
      siteId: site_id,
      workflowId,
      scheduleId: `daily-prospection-${site_id}`,
      activityName: 'dailyProspectionWorkflow',
      status: 'COMPLETED',
      lastRun: new Date().toISOString()
    });

    // Log successful completion
    await logWorkflowExecutionActivity({
      workflowId,
      workflowType: 'dailyProspectionWorkflow',
      status: 'COMPLETED',
      input: options,
      output: result,
    });

    return result;

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Daily prospection workflow failed: ${errorMessage}`);
    
    const executionTime = `${((Date.now() - startTime) / 1000).toFixed(2)}s`;
    
    // Update cron status to indicate failure
    await saveCronStatusActivity({
      siteId: site_id,
      workflowId,
      scheduleId: `daily-prospection-${site_id}`,
      activityName: 'dailyProspectionWorkflow',
      status: 'FAILED',
      lastRun: new Date().toISOString(),
      errorMessage: errorMessage,
      retryCount: 1
    });

    // Log workflow execution failure
    await logWorkflowExecutionActivity({
      workflowId,
      workflowType: 'dailyProspectionWorkflow',
      status: 'FAILED',
      input: options,
      error: errorMessage,
    });

    // Return failed result instead of throwing to provide more information
    const result: DailyProspectionResult = {
      success: false,
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
      // Add follow-up fields with default values for error case
      followUpWorkflowsStarted: 0,
      followUpResults: [],
      unassignedLeads: [],
      errors: [...errors, errorMessage],
      executionTime,
      completedAt: new Date().toISOString()
    };

    return result;
  }
}