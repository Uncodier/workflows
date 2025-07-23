/**
 * Daily Prospection Activities
 * Activities for managing daily prospection workflow
 */

import { getSupabaseService } from '../services/supabaseService';
import { logger } from '../../lib/logger';
import { apiService } from '../services/apiService';

// Interfaces for daily prospection
export interface ProspectionLead {
  id: string;
  name: string;
  email: string;
  status: string;
  created_at: string;
  site_id: string;
  assignee_id?: string;
  phone?: string;
  position?: string;
  company?: any;
  company_name?: string;
  segment_id?: string;
  [key: string]: any;
}

export interface DailyProspectionOptions {
  site_id: string;
  userId?: string;
  hoursThreshold?: number; // Default 48 hours
  additionalData?: any;
}

// New interfaces for communication channels validation
export interface ValidateCommunicationChannelsParams {
  site_id: string;
}

export interface ValidateCommunicationChannelsResult {
  success: boolean;
  hasEmailChannel: boolean;
  hasWhatsappChannel: boolean;
  hasAnyChannel: boolean;
  emailConfig?: any;
  whatsappConfig?: any;
  error?: string;
}

export interface GetProspectionLeadsResult {
  success: boolean;
  leads: ProspectionLead[];
  total: number;
  error?: string;
  criteria?: {
    site_id: string;
    status: string;
    hoursThreshold: number;
    createdBefore: string;
  };
}

export interface CreateAwarenessTaskOptions {
  lead_id: string;
  site_id: string;
  userId?: string;
  title?: string;
  description?: string;
  scheduled_date?: string;
  additionalData?: any;
}

export interface CreateAwarenessTaskResult {
  success: boolean;
  task?: any;
  taskId?: string;
  error?: string;
  skipped?: boolean;
  reason?: string;
}

/**
 * Activity to validate communication channels (email or WhatsApp) are configured for a site
 */
export async function validateCommunicationChannelsActivity(
  params: ValidateCommunicationChannelsParams
): Promise<ValidateCommunicationChannelsResult> {
  console.log(`📡 Validating communication channels for site: ${params.site_id}`);
  
  try {
    const supabaseService = getSupabaseService();
    
    console.log('🔍 Checking database connection...');
    const isConnected = await supabaseService.getConnectionStatus();
    
    if (!isConnected) {
      console.log('⚠️  Database not available, cannot validate communication channels');
      return {
        success: false,
        hasEmailChannel: false,
        hasWhatsappChannel: false,
        hasAnyChannel: false,
        error: 'Database not available'
      };
    }

    console.log('✅ Database connection confirmed, fetching settings...');
    
    // Get settings for the site
    const settings = await supabaseService.fetchCompleteSettings([params.site_id]);
    
    if (!settings || settings.length === 0) {
      console.log('⚠️  No settings found for site');
      return {
        success: true,
        hasEmailChannel: false,
        hasWhatsappChannel: false,
        hasAnyChannel: false,
        error: 'No settings found for site'
      };
    }

    const siteSettings = settings[0];
    const channels = siteSettings.channels || {};
    
    console.log(`🔍 Checking channel configurations for channels:`, channels);
    
    let hasEmailChannel = false;
    let hasWhatsappChannel = false;
    let emailConfig = null;
    let whatsappConfig = null;
    
    // Handle different channel structure formats
    if (Array.isArray(channels)) {
      // Array format: channels is an array of channel objects
      console.log(`📋 Processing channels as array with ${channels.length} configurations`);
      
      emailConfig = channels.find((channel: any) => 
        channel.type === 'email' && channel.enabled === true
      );
      
      whatsappConfig = channels.find((channel: any) => 
        channel.type === 'whatsapp' && channel.enabled === true
      );
      
      hasEmailChannel = !!emailConfig;
      hasWhatsappChannel = !!whatsappConfig;
      
    } else if (typeof channels === 'object' && channels !== null) {
      // Object format: channels.email.enabled, channels.whatsapp.enabled
      console.log(`📋 Processing channels as object structure`);
      
      // Check email configuration
      if (channels.email && typeof channels.email === 'object') {
        hasEmailChannel = channels.email.enabled === true;
        if (hasEmailChannel) {
          emailConfig = channels.email;
        }
        console.log(`   - Email enabled: ${hasEmailChannel}`, channels.email);
      }
      
      // Check WhatsApp configuration  
      if (channels.whatsapp && typeof channels.whatsapp === 'object') {
        hasWhatsappChannel = channels.whatsapp.enabled === true;
        if (hasWhatsappChannel) {
          whatsappConfig = channels.whatsapp;
        }
        console.log(`   - WhatsApp enabled: ${hasWhatsappChannel}`, channels.whatsapp);
      }
      
    } else {
      console.log(`⚠️  Channels configuration is neither array nor object:`, typeof channels);
    }
    const hasAnyChannel = hasEmailChannel || hasWhatsappChannel;
    
    console.log(`📊 Channel validation results:`);
    console.log(`   - Email enabled: ${hasEmailChannel ? '✅' : '❌'}`);
    console.log(`   - WhatsApp enabled: ${hasWhatsappChannel ? '✅' : '❌'}`);
    console.log(`   - Any channel available: ${hasAnyChannel ? '✅' : '❌'}`);
    
    if (!hasAnyChannel) {
      console.log('❌ No communication channels (email or WhatsApp) are configured and enabled');
      
      // Send notification about missing channel configuration
      console.log('📤 Sending channels setup required notification...');
      try {
        const notificationResponse = await apiService.post('/api/notifications/channelsSetupRequired', {
          site_id: params.site_id
        });
        
        if (notificationResponse.success) {
          console.log('✅ Channels setup notification sent successfully');
        } else {
          console.error('❌ Failed to send channels setup notification:', notificationResponse.error);
        }
      } catch (notificationError) {
        const errorMessage = notificationError instanceof Error ? notificationError.message : String(notificationError);
        console.error('❌ Exception sending channels setup notification:', errorMessage);
      }
      
      return {
        success: true,
        hasEmailChannel: false,
        hasWhatsappChannel: false,
        hasAnyChannel: false,
        error: 'No communication channels (email or WhatsApp) are configured and enabled'
      };
    }

    console.log('✅ Communication channels validation completed successfully');
    return {
      success: true,
      hasEmailChannel,
      hasWhatsappChannel,
      hasAnyChannel,
      emailConfig: hasEmailChannel ? emailConfig : undefined,
      whatsappConfig: hasWhatsappChannel ? whatsappConfig : undefined
    };
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('❌ Exception validating communication channels:', errorMessage);
    
    return {
      success: false,
      hasEmailChannel: false,
      hasWhatsappChannel: false,
      hasAnyChannel: false,
      error: errorMessage
    };
  }
}

/**
 * Activity to get leads for daily prospection
 * Finds leads with:
 * - More than X hours old (default 48)
 * - Status = 'new'
 * - No active tasks in 'awareness' stage (pending tasks are allowed)
 */
export async function getProspectionLeadsActivity(
  options: DailyProspectionOptions
): Promise<GetProspectionLeadsResult> {
  const { site_id, hoursThreshold = 48 } = options;
  
  console.log(`🔍 Getting prospection leads for site: ${site_id}`);
  console.log(`   - Hours threshold: ${hoursThreshold} hours`);
  
  try {
    const supabaseService = getSupabaseService();
    
    console.log('🔍 Checking database connection...');
    const isConnected = await supabaseService.getConnectionStatus();
    
    if (!isConnected) {
      console.log('⚠️ Database not available, cannot fetch prospection leads');
      return {
        success: false,
        leads: [],
        total: 0,
        error: 'Database not available'
      };
    }

    console.log('✅ Database connection confirmed, fetching prospection leads...');
    
    // Import supabase service role client (bypasses RLS)
    const { supabaseServiceRole } = await import('../../lib/supabase/client');

    // Calculate the threshold date (48 hours ago by default)
    const thresholdDate = new Date();
    thresholdDate.setHours(thresholdDate.getHours() - hoursThreshold);
    const createdBefore = thresholdDate.toISOString();
    
    console.log(`📅 Looking for leads created before: ${createdBefore}`);
    
    // First, get all leads with status 'new' and older than threshold
    const { data: candidateLeads, error: leadsError } = await supabaseServiceRole
      .from('leads')
      .select('*')
      .eq('site_id', site_id)
      .eq('status', 'new')
      .lt('created_at', createdBefore)
      .order('created_at', { ascending: true }); // Oldest first for prospection
    
    if (leadsError) {
      logger.error('❌ Error fetching candidate leads', {
        error: leadsError.message,
        site_id,
        hoursThreshold
      });
      return {
        success: false,
        leads: [],
        total: 0,
        error: leadsError.message
      };
    }
    
    console.log(`📋 Found ${candidateLeads?.length || 0} candidate leads with status 'new' older than ${hoursThreshold} hours`);
    
    if (!candidateLeads || candidateLeads.length === 0) {
      console.log('✅ No candidate leads found for prospection');
      return {
        success: true,
        leads: [],
        total: 0,
        criteria: {
          site_id,
          status: 'new',
          hoursThreshold,
          createdBefore
        }
      };
    }

    // Get lead IDs for task filtering
    const leadIds = candidateLeads.map(lead => lead.id);
    
    // Now check which of these leads have tasks in 'awareness' stage
    const { data: awarenessTasksData, error: tasksError } = await supabaseServiceRole
      .from('tasks')
      .select('lead_id, id, status, stage')
      .eq('site_id', site_id)
      .eq('stage', 'awareness')
      .in('lead_id', leadIds);
    
    if (tasksError) {
      logger.error('❌ Error checking awareness tasks', {
        error: tasksError.message,
        site_id,
        leadIds: leadIds.length
      });
      return {
        success: false,
        leads: [],
        total: 0,
        error: tasksError.message
      };
    }
    
    console.log(`📋 Found ${awarenessTasksData?.length || 0} existing awareness tasks for candidate leads`);
    
    // Filter out tasks that are in 'pending' status - those leads are still eligible
    const activeTasks = (awarenessTasksData || []).filter(task => task.status !== 'pending');
    const pendingTasks = (awarenessTasksData || []).filter(task => task.status === 'pending');
    
    console.log(`📋 Task status breakdown:`);
    console.log(`   - Total awareness tasks: ${awarenessTasksData?.length || 0}`);
    console.log(`   - Active tasks (excluding leads): ${activeTasks.length}`);
    console.log(`   - Pending tasks (leads still eligible): ${pendingTasks.length}`);
    
    if (pendingTasks.length > 0) {
      console.log(`✅ Note: ${pendingTasks.length} leads with pending awareness tasks will remain eligible for contact`);
    }
    
    // Create a set of lead IDs that have NON-PENDING awareness tasks
    const leadsWithActiveAwarenessTasks = new Set(
      activeTasks.map(task => task.lead_id)
    );
    
    // Filter out leads that have active (non-pending) awareness tasks
    const leadsWithoutAwarenessTasks = candidateLeads.filter(
      lead => !leadsWithActiveAwarenessTasks.has(lead.id)
    );
    
    console.log(`📋 After active awareness task filtering: ${leadsWithoutAwarenessTasks.length} leads available (excluded leads with non-pending tasks)`);
    
    // 🔒 ASSIGNEE_ID VALIDATION: Filter leads by assignee_id and company rules
    console.log(`🔒 Applying assignee_id validation rules...`);
    
    // Step 1: Group leads by company
    const leadsGroupedByCompany = new Map<string, any[]>();
    const leadsWithoutCompany: any[] = [];
    
    leadsWithoutAwarenessTasks.forEach(lead => {
      const companyId = lead.company_id;
      const companyName = lead.company?.name;
      
      // Use company_id as primary key, fallback to company.name, then to 'no-company' group
      let companyKey = 'no-company';
      if (companyId) {
        companyKey = `id:${companyId}`;
      } else if (companyName) {
        companyKey = `name:${companyName.toLowerCase().trim()}`;
      }
      
      if (companyKey === 'no-company') {
        leadsWithoutCompany.push(lead);
      } else {
        if (!leadsGroupedByCompany.has(companyKey)) {
          leadsGroupedByCompany.set(companyKey, []);
        }
        leadsGroupedByCompany.get(companyKey)!.push(lead);
      }
    });
    
    console.log(`📊 Company grouping results:`);
    console.log(`   - Companies with leads: ${leadsGroupedByCompany.size}`);
    console.log(`   - Leads without company: ${leadsWithoutCompany.length}`);
    
    // Step 2: Filter companies - exclude companies where ANY lead has assignee_id
    const validCompanyLeads: any[] = [];
    const excludedCompanies: string[] = [];
    const excludedCompanyLeadsCount = { total: 0, withAssignee: 0 };
    
    leadsGroupedByCompany.forEach((companyLeads, companyKey) => {
      const leadsWithAssignee = companyLeads.filter(lead => lead.assignee_id);
      
      if (leadsWithAssignee.length > 0) {
        // Exclude entire company if ANY lead has assignee_id
        excludedCompanies.push(companyKey);
        excludedCompanyLeadsCount.total += companyLeads.length;
        excludedCompanyLeadsCount.withAssignee += leadsWithAssignee.length;
        
        const companyName = companyKey.startsWith('id:') ? 
          companyLeads[0]?.company?.name || 'Unknown' : 
          companyKey.replace('name:', '');
        
        console.log(`❌ Excluding company "${companyName}" (${companyLeads.length} leads) - ${leadsWithAssignee.length} lead(s) have assignee_id`);
      } else {
        // Include all leads from this company (none have assignee_id)
        validCompanyLeads.push(...companyLeads);
        
        const companyName = companyKey.startsWith('id:') ? 
          companyLeads[0]?.company?.name || 'Unknown' : 
          companyKey.replace('name:', '');
        
        console.log(`✅ Including company "${companyName}" (${companyLeads.length} leads) - no assignee_id found`);
      }
    });
    
    // Step 3: Filter individual leads without company - exclude those with assignee_id
    const validIndividualLeads = leadsWithoutCompany.filter(lead => !lead.assignee_id);
    const excludedIndividualLeads = leadsWithoutCompany.filter(lead => lead.assignee_id);
    
    if (excludedIndividualLeads.length > 0) {
      console.log(`❌ Excluding ${excludedIndividualLeads.length} individual leads with assignee_id`);
    }
    
    if (validIndividualLeads.length > 0) {
      console.log(`✅ Including ${validIndividualLeads.length} individual leads without assignee_id`);
    }
    
    // Step 4: Combine all valid leads
    const prospectionLeads = [...validCompanyLeads, ...validIndividualLeads];
    
    console.log(`🔒 Assignee_id validation completed:`);
    console.log(`   - Original leads (after awareness filter): ${leadsWithoutAwarenessTasks.length}`);
    console.log(`   - Companies excluded: ${excludedCompanies.length} (${excludedCompanyLeadsCount.total} leads)`);
    console.log(`   - Individual leads excluded: ${excludedIndividualLeads.length}`);
    console.log(`   - Final leads for prospection: ${prospectionLeads.length}`);
    
    console.log(`✅ Successfully identified ${prospectionLeads.length} leads for prospection`);
    console.log(`   - Total candidates: ${candidateLeads.length}`);
    console.log(`   - With active awareness tasks: ${leadsWithActiveAwarenessTasks.size}`);
    console.log(`   - Excluded by assignee_id rules: ${leadsWithoutAwarenessTasks.length - prospectionLeads.length}`);
    console.log(`   - Available for prospection: ${prospectionLeads.length}`);
    
    if (prospectionLeads.length > 0) {
      console.log(`📋 Prospection leads summary:`);
      prospectionLeads.forEach((lead, index) => {
        const daysOld = Math.floor((new Date().getTime() - new Date(lead.created_at).getTime()) / (1000 * 60 * 60 * 24));
        const companyInfo = lead.company?.name ? ` (${lead.company.name})` : '';
        console.log(`   ${index + 1}. ${lead.name || lead.email}${companyInfo} (${daysOld} days old)`);
      });
    }
    
    return {
      success: true,
      leads: prospectionLeads,
      total: prospectionLeads.length,
      criteria: {
        site_id,
        status: 'new',
        hoursThreshold,
        createdBefore
      }
    };
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('❌ Exception getting prospection leads', {
      error: errorMessage,
      site_id,
      hoursThreshold
    });
    
    return {
      success: false,
      leads: [],
      total: 0,
      error: errorMessage
    };
  }
}

/**
 * Activity to check if lead has any existing tasks (awareness or later stages)
 */
export async function checkLeadExistingTasksActivity(
  options: { lead_id: string; site_id: string }
): Promise<{
  success: boolean;
  hasExistingTasks: boolean;
  existingTasks: any[];
  error?: string;
}> {
  const { lead_id, site_id } = options;
  
  console.log(`🔍 Checking existing tasks for lead: ${lead_id}`);
  
  try {
    const supabaseService = getSupabaseService();
    
    const isConnected = await supabaseService.getConnectionStatus();
    if (!isConnected) {
      console.log('⚠️ Database not available, cannot check existing tasks');
      return {
        success: false,
        hasExistingTasks: false,
        existingTasks: [],
        error: 'Database not available'
      };
    }

    // Import supabase service role client (bypasses RLS)
    const { supabaseServiceRole } = await import('../../lib/supabase/client');

    // Check for any existing tasks (awareness or later stages)
    const { data: existingTasks, error: checkError } = await supabaseServiceRole
      .from('tasks')
      .select('id, status, stage, title, created_at')
      .eq('lead_id', lead_id)
      .eq('site_id', site_id)
      .in('stage', ['awareness', 'consideration', 'decision', 'purchase', 'retention', 'referral'])
      .order('created_at', { ascending: false });
    
    if (checkError) {
      logger.error('❌ Error checking existing tasks', {
        error: checkError.message,
        lead_id,
        site_id
      });
      return {
        success: false,
        hasExistingTasks: false,
        existingTasks: [],
        error: checkError.message
      };
    }
    
    const hasExistingTasks = existingTasks && existingTasks.length > 0;
    
    if (hasExistingTasks) {
      console.log(`⚠️ Lead ${lead_id} already has ${existingTasks.length} task(s):`);
      existingTasks.forEach((task, index) => {
        console.log(`   ${index + 1}. ${task.title} (${task.stage}/${task.status}) - Created: ${task.created_at}`);
      });
    } else {
      console.log(`✅ Lead ${lead_id} has no existing tasks - eligible for new awareness task`);
    }
    
    return {
      success: true,
      hasExistingTasks,
      existingTasks: existingTasks || []
    };
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('❌ Exception checking existing tasks', {
      error: errorMessage,
      lead_id,
      site_id
    });
    
    return {
      success: false,
      hasExistingTasks: false,
      existingTasks: [],
      error: errorMessage
    };
  }
}

/**
 * Activity to create an awareness task for a lead
 */
export async function createAwarenessTaskActivity(
  options: CreateAwarenessTaskOptions
): Promise<CreateAwarenessTaskResult> {
  const { lead_id, site_id, userId } = options;
  
  console.log(`📝 Creating awareness task for lead: ${lead_id}`);
  
  try {
    const supabaseService = getSupabaseService();
    
    console.log('🔍 Checking database connection...');
    const isConnected = await supabaseService.getConnectionStatus();
    
    if (!isConnected) {
      console.log('⚠️ Database not available, cannot create awareness task');
      return {
        success: false,
        error: 'Database not available'
      };
    }

    console.log('✅ Database connection confirmed, creating awareness task...');
    
    // Import supabase service role client (bypasses RLS)
    const { supabaseServiceRole } = await import('../../lib/supabase/client');

    // Check if lead exists
    const { data: lead, error: leadError } = await supabaseServiceRole
      .from('leads')
      .select('id, name, email, site_id')
      .eq('id', lead_id)
      .eq('site_id', site_id)
      .single();
    
    if (leadError || !lead) {
      const errorMsg = `Lead ${lead_id} not found or doesn't belong to site ${site_id}`;
      logger.error('❌ Lead not found for awareness task creation', {
        lead_id,
        site_id,
        error: leadError?.message
      });
      return {
        success: false,
        error: errorMsg
      };
    }
    
    // Check if any tasks already exist (awareness or later stages)
    const { data: existingTasks, error: checkError } = await supabaseServiceRole
      .from('tasks')
      .select('id, status, stage, title, created_at')
      .eq('lead_id', lead_id)
      .eq('site_id', site_id)
      .in('stage', ['awareness', 'consideration', 'decision', 'purchase', 'retention', 'referral'])
      .order('created_at', { ascending: false });
    
    if (checkError) {
      logger.error('❌ Error checking existing tasks', {
        error: checkError.message,
        lead_id,
        site_id
      });
      return {
        success: false,
        error: checkError.message
      };
    }
    
    if (existingTasks && existingTasks.length > 0) {
      const mostRecentTask = existingTasks[0];
      console.log(`⚠️ Lead ${lead_id} already has ${existingTasks.length} task(s). Most recent: ${mostRecentTask.title} (${mostRecentTask.stage}/${mostRecentTask.status})`);
      console.log(`❌ Skipping task creation - lead already has tasks in the system`);
      return {
        success: true,
        task: mostRecentTask,
        taskId: mostRecentTask.id,
        skipped: true,
        reason: `Lead already has ${existingTasks.length} existing task(s)`
      };
    }

    // Prepare task data
    const scheduledDate = options.scheduled_date || new Date().toISOString();
    const title = options.title || `Inicial awareness para ${lead.name || lead.email}`;
    const description = options.description || `Tarea de prospección inicial para establecer primer contacto con el lead ${lead.name || lead.email}`;
    
    const taskData = {
      lead_id: lead_id,
      title: title,
      description: description,
      type: 'prospection',
      stage: 'awareness',
      status: 'pending',
      scheduled_date: scheduledDate,
      assignee: userId || null,
      site_id: site_id,
      user_id: userId || null,
      priority: 1, // High priority for new prospection
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    // Create the awareness task
    const { data: task, error: createError } = await supabaseServiceRole
      .from('tasks')
      .insert([taskData])
      .select()
      .single();

    if (createError) {
      logger.error('❌ Failed to create awareness task', {
        error: createError.message,
        lead_id,
        site_id
      });
      return {
        success: false,
        error: createError.message
      };
    }

    logger.info('✅ Awareness task created successfully', {
      taskId: task.id,
      leadId: lead_id,
      siteId: site_id,
      title: task.title
    });
    
    console.log(`✅ Successfully created awareness task ${task.id} for lead ${lead.name || lead.email}`);

    return {
      success: true,
      task: task,
      taskId: task.id
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('❌ Exception creating awareness task', {
      error: errorMessage,
      lead_id,
      site_id
    });
    
    return {
      success: false,
      error: errorMessage
    };
  }
}

/**
 * Activity to update lead status after prospection task creation
 */
export async function updateLeadProspectionStatusActivity(
  options: {
    lead_id: string;
    site_id: string;
    newStatus?: string;
    userId?: string;
    notes?: string;
  }
): Promise<{ success: boolean; error?: string }> {
  const { lead_id, site_id, newStatus = 'contacted', notes } = options;
  
  console.log(`📝 Updating lead prospection status for: ${lead_id} to '${newStatus}'`);
  
  try {
    const supabaseService = getSupabaseService();
    
    const isConnected = await supabaseService.getConnectionStatus();
    if (!isConnected) {
      return {
        success: false,
        error: 'Database not available'
      };
    }

    // Import supabase service role client (bypasses RLS)
    const { supabaseServiceRole } = await import('../../lib/supabase/client');

    const updateData: any = {
      status: newStatus,
      updated_at: new Date().toISOString(),
      last_contact: new Date().toISOString()
    };
    
    if (notes) {
      updateData.notes = notes;
    }

    const { error } = await supabaseServiceRole
      .from('leads')
      .update(updateData)
      .eq('id', lead_id)
      .eq('site_id', site_id)
      .select()
      .single();

    if (error) {
      logger.error('❌ Failed to update lead prospection status', {
        error: error.message,
        lead_id,
        site_id,
        newStatus
      });
      return {
        success: false,
        error: error.message
      };
    }

    console.log(`✅ Successfully updated lead ${lead_id} status to '${newStatus}'`);
    return {
      success: true
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('❌ Exception updating lead prospection status', {
      error: errorMessage,
      lead_id,
      site_id
    });
    
    return {
      success: false,
      error: errorMessage
    };
  }
} 

/**
 * Activity to send leads to sales agent for lead selection and prioritization
 */
export async function sendLeadsToSalesAgentActivity(
  options: {
    site_id: string;
    leads: ProspectionLead[];
    userId?: string;
    additionalData?: any;
  }
): Promise<{
  success: boolean;
  response?: any;
  selectedLeads?: any[];
  priority?: any;
  error?: string;
}> {
  const { site_id, leads, userId } = options;
  
  console.log(`🎯 Sending ${leads.length} leads to sales agent for selection and prioritization`);
  console.log(`   - Site ID: ${site_id}`);
  console.log(`   - User ID: ${userId}`);
  
  try {
    if (!leads || leads.length === 0) {
      console.log('ℹ️ No leads to send to sales agent');
      return {
        success: true,
        selectedLeads: [],
        response: { message: 'No leads provided' }
      };
    }

    // Prepare request body for the sales agent API
    // Send only lead IDs and site_id at root level
    const requestBody = {
      site_id: site_id,
      leads: leads.map(lead => lead.id), // Send only the IDs
      userId: userId,
      additionalData: {
        workflowType: 'dailyProspection',
        ...options.additionalData
      }
    };

    console.log('📤 Sending leads to sales agent API:', {
      leadCount: leads.length,
      endpoint: '/api/agents/sales/leadSelection'
    });

    // Call the sales agent API with reasonable timeout (2 minutes)
    const response = await apiService.request('/api/agents/sales/leadSelection', {
      method: 'POST',
      body: requestBody,
      timeout: 120000 // 2 minutes timeout for lead selection
    });

    if (!response.success) {
      console.error(`❌ Failed to send leads to sales agent:`, response.error);
      return {
        success: false,
        error: response.error?.message || 'Failed to send leads to sales agent'
      };
    }

    console.log(`✅ Successfully sent leads to sales agent`);
    console.log(`📊 Sales agent response:`, JSON.stringify(response.data, null, 2));

    // Extract selected leads and priority information from response
    const selectedLeads = response.data?.selectedLeads || response.data?.leads || response.data?.results || [];
    const priority = response.data?.priority || response.data?.prioritization || response.data?.analysis;

    console.log(`🎯 Sales agent results:`);
    console.log(`   - Selected leads: ${selectedLeads.length}`);
    console.log(`   - Priority analysis: ${priority ? 'Available' : 'Not provided'}`);

    return {
      success: true,
      response: response.data,
      selectedLeads: selectedLeads,
      priority: priority
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Exception sending leads to sales agent:`, errorMessage);
    
    return {
      success: false,
      error: errorMessage
    };
  }
} 

/**
 * Activity to assign priority leads based on sales agent response
 */
export async function assignPriorityLeadsActivity(
  options: {
    site_id: string;
    salesAgentResponse: any;
    userId?: string;
    additionalData?: any;
  }
): Promise<{
  success: boolean;
  assignedLeads: any[];
  notificationResults: any[];
  error?: string;
}> {
  const { site_id, salesAgentResponse } = options;
  
  console.log(`📋 Processing lead assignments from sales agent response`);
  console.log(`   - Site ID: ${site_id}`);
  
  try {
    const importantAccounts = salesAgentResponse?.important_accounts || [];
    
    if (!importantAccounts || importantAccounts.length === 0) {
      console.log('ℹ️ No important accounts found for assignment');
      return {
        success: true,
        assignedLeads: [],
        notificationResults: []
      };
    }

    console.log(`🎯 Found ${importantAccounts.length} important accounts for assignment`);

    const supabaseService = getSupabaseService();
    const isConnected = await supabaseService.getConnectionStatus();
    
    if (!isConnected) {
      console.log('⚠️ Database not available, cannot assign leads');
      return {
        success: false,
        assignedLeads: [],
        notificationResults: [],
        error: 'Database not available'
      };
    }

    // Import supabase service role client (bypasses RLS)
    const { supabaseServiceRole } = await import('../../lib/supabase/client');

    const assignedLeads: any[] = [];
    const notificationResults: any[] = [];

    // Process each important account
    for (const account of importantAccounts) {
      const leadId = account.lead_id;
      const assigneeId = account.recommended_assignee_id;
      const assigneeName = account.recommended_assignee_name;
      
      if (!leadId || !assigneeId) {
        console.log(`⚠️ Skipping account - missing lead_id or assignee_id:`, account);
        continue;
      }

      console.log(`📌 Assigning lead ${leadId} to ${assigneeName} (${assigneeId})`);

      try {
        // Step 1: Update lead assignee_id in database
        const { data: updatedLead, error: updateError } = await supabaseServiceRole
          .from('leads')
          .update({
            assignee_id: assigneeId,
            updated_at: new Date().toISOString(),
            last_contact: new Date().toISOString()
          })
          .eq('id', leadId)
          .eq('site_id', site_id)
          .select()
          .single();

        if (updateError) {
          console.error(`❌ Failed to update lead ${leadId} assignee:`, updateError);
          continue;
        }

        console.log(`✅ Successfully updated lead ${leadId} assignee to ${assigneeId}`);

        // Step 2: Send lead assignment notification
        const contactRecommendation = salesAgentResponse?.contact_recommendations?.find(
          (rec: any) => rec.lead_id === leadId
        );

        const priorityLead = salesAgentResponse?.priority_leads?.find(
          (lead: any) => lead.primary_lead_id === leadId
        );

        const notificationBody = {
          lead_id: leadId,
          assignee_id: assigneeId,
          brief: `Cuenta importante: ${account.company} - ${account.assignment_reasoning}`,
          next_steps: contactRecommendation?.key_talking_points 
            ? contactRecommendation.key_talking_points.split(', ').map((point: string) => `Enfocar en: ${point}`)
            : ['Contactar al prospecto', 'Revisar información de la empresa', 'Preparar propuesta inicial'],
          priority: contactRecommendation?.urgency?.toLowerCase() || 'medium',
          due_date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0], // Tomorrow
          additional_context: `${account.assignment_reasoning}. ${contactRecommendation?.contact_strategy || ''}`,
          include_team_notification: true,
          metadata: {
            source: 'daily_prospection_workflow',
            account_value: account.account_value,
            priority_score: priorityLead?.priority_score,
            company: account.company,
            workflow_id: options.additionalData?.workflowId
          }
        };

        console.log('📤 Sending lead assignment notification:', {
          lead_id: leadId,
          assignee_id: assigneeId,
          company: account.company
        });

        const notificationResponse = await apiService.request('/api/notifications/leadAssignment', {
          method: 'POST',
          body: notificationBody,
          timeout: 30000 // 30 seconds timeout for notifications
        });

        if (notificationResponse.success) {
          console.log(`✅ Successfully sent assignment notification for lead ${leadId}`);
          notificationResults.push({
            lead_id: leadId,
            assignee_id: assigneeId,
            success: true,
            response: notificationResponse.data
          });
        } else {
          console.error(`❌ Failed to send assignment notification for lead ${leadId}:`, notificationResponse.error);
          notificationResults.push({
            lead_id: leadId,
            assignee_id: assigneeId,
            success: false,
            error: notificationResponse.error?.message || 'Failed to send notification'
          });
        }

        assignedLeads.push({
          lead_id: leadId,
          assignee_id: assigneeId,
          assignee_name: assigneeName,
          company: account.company,
          account_value: account.account_value,
          assignment_reasoning: account.assignment_reasoning,
          updated_lead: updatedLead
        });

      } catch (leadError) {
        const errorMessage = leadError instanceof Error ? leadError.message : String(leadError);
        console.error(`❌ Exception processing lead assignment ${leadId}:`, errorMessage);
        
        notificationResults.push({
          lead_id: leadId,
          assignee_id: assigneeId,
          success: false,
          error: errorMessage
        });
      }
    }

    console.log(`✅ Lead assignment process completed:`);
    console.log(`   - Total important accounts: ${importantAccounts.length}`);
    console.log(`   - Successfully assigned: ${assignedLeads.length}`);
    console.log(`   - Notification successes: ${notificationResults.filter(r => r.success).length}`);
    console.log(`   - Notification failures: ${notificationResults.filter(r => !r.success).length}`);

    return {
      success: true,
      assignedLeads,
      notificationResults
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Exception in lead assignment activity:`, errorMessage);
    
    return {
      success: false,
      assignedLeads: [],
      notificationResults: [],
      error: errorMessage
    };
  }
} 