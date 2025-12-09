import { getSupabaseService } from '../services/supabaseService';

/**
 * Newsletter activity interfaces
 */
export interface ValidateEmailConfigurationParams {
  site_id: string;
}

export interface ValidateEmailConfigurationResult {
  success: boolean;
  hasEmailConfig: boolean;
  error?: string;
  emailConfig?: any;
}

export interface GetLeadsBySegmentsParams {
  site_id: string;
  segment_ids: string[]; // Empty array means no segment filter
  status: string[];      // Empty array means no status filter
  limit?: number;
}

export interface GetLeadsBySegmentsResult {
  success: boolean;
  leads: any[];
  total: number;
  error?: string;
}

export interface SendNewsletterEmailParams {
  leads: any[];
  site_id: string;
  subject: string;
  message: string;
  maxEmails?: number;
}

export interface SendNewsletterEmailResult {
  success: boolean;
  emailsSent: number;
  emailsFailed: number;
  results: any[];
  error?: string;
}

/**
 * Activity to validate email configuration exists for a site
 */
export async function validateEmailConfigurationActivity(
  params: ValidateEmailConfigurationParams
): Promise<ValidateEmailConfigurationResult> {
  console.log(`📧 Validating email configuration for site: ${params.site_id}`);
  
  try {
    const supabaseService = getSupabaseService();
    
    console.log('🔍 Checking database connection...');
    const isConnected = await supabaseService.getConnectionStatus();
    
    if (!isConnected) {
      console.log('⚠️  Database not available, cannot validate email configuration');
      return {
        success: false,
        hasEmailConfig: false,
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
        hasEmailConfig: false,
        error: 'No settings found for site'
      };
    }

    const siteSettings = settings[0];
    const channels = siteSettings.channels || [];
    
    let emailConfig = null;
    let agentConfig = null;
    let agentMailConfig = null;

    // Handle both array and object formats for channels
    if (Array.isArray(channels)) {
      // Array format
      emailConfig = channels.find((channel: any) => 
        channel.type === 'email' && channel.enabled === true && (channel.status === 'active' || channel.status === 'synced')
      );
      agentConfig = channels.find((channel: any) => 
        channel.type === 'agent' && channel.enabled === true && channel.status === 'active'
      );
      agentMailConfig = channels.find((channel: any) => 
        channel.type === 'agent_mail' && channel.enabled === true && channel.status === 'active'
      );
    } else if (typeof channels === 'object' && channels !== null) {
      // Object format
      if (channels.email && channels.email.enabled === true && (channels.email.status === 'active' || channels.email.status === 'synced')) {
        emailConfig = channels.email;
      }
      if (channels.agent && channels.agent.enabled === true && channels.agent.status === 'active') {
        agentConfig = channels.agent;
      }
      if (channels.agent_mail && channels.agent_mail.enabled === true && channels.agent_mail.status === 'active') {
        agentMailConfig = channels.agent_mail;
      }
    }
    
    // Check if any valid email sending channel exists
    if (!emailConfig && !agentConfig && !agentMailConfig) {
      console.log('❌ No email configuration found or email is disabled');
      return {
        success: true,
        hasEmailConfig: false,
        error: 'Email configuration not found or disabled'
      };
    }

    // Validate email configuration has required fields if it exists.
    // Even if agent config exists, if emailConfig is present it takes precedence and must be valid.
    if (emailConfig) {
      const requiredFields = ['smtp_host', 'smtp_port', 'smtp_user', 'smtp_password'];
      const missingFields = requiredFields.filter(field => !emailConfig[field]);
      
      if (missingFields.length > 0) {
        console.log(`❌ Email configuration missing required fields: ${missingFields.join(', ')}`);
        return {
          success: true,
          hasEmailConfig: false,
          error: `Email configuration missing required fields: ${missingFields.join(', ')}`
        };
      }
    }

    console.log('✅ Email configuration validated successfully');
    return {
      success: true,
      hasEmailConfig: true,
      // Return the most relevant config, prioritizing direct email if available, then agent
      emailConfig: emailConfig || agentConfig || agentMailConfig
    };
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Exception validating email configuration:`, errorMessage);
    
    return {
      success: false,
      hasEmailConfig: false,
      error: errorMessage
    };
  }
}

/**
 * Activity to get leads by segments and status with optional filters
 * Business Rules:
 * - segment_ids: if empty array, no segment filter is applied
 * - status: if empty array, no status filter is applied
 * - Always filters for leads with valid email
 * - Returns latest leads by creation date (newest first)
 * - Respects limit (default 500)
 */
export async function getLeadsBySegmentsActivity(
  params: GetLeadsBySegmentsParams
): Promise<GetLeadsBySegmentsResult> {
  console.log(`👥 Getting leads for site: ${params.site_id}`);
  
  // Log filter status
  if (params.segment_ids.length === 0) {
    console.log(`   - Segments: No filter (all segments)`);
  } else {
    console.log(`   - Segments: ${params.segment_ids.join(', ')}`);
  }
  
  if (params.status.length === 0) {
    console.log(`   - Status: No filter (all statuses)`);
  } else {
    console.log(`   - Status: ${params.status.join(', ')}`);
  }
  
  console.log(`   - Limit: ${params.limit || 500}`);
  
  try {
    const supabaseService = getSupabaseService();
    
    console.log('🔍 Checking database connection...');
    const isConnected = await supabaseService.getConnectionStatus();
    
    if (!isConnected) {
      console.log('⚠️  Database not available, cannot fetch leads');
      return {
        success: false,
        leads: [],
        total: 0,
        error: 'Database not available'
      };
    }

    console.log('✅ Database connection confirmed, fetching leads...');
    
    // Use the updated method with optional filters
    const { data, error } = await supabaseService.fetchLeadsBySegmentsAndStatus(
      params.site_id,
      params.segment_ids,
      params.status,
      params.limit
    );
    
    if (error) {
      console.error('❌ Error fetching leads:', error);
      return {
        success: false,
        leads: [],
        total: 0,
        error: `Failed to fetch leads: ${error.message}`
      };
    }
    
    const leads = data || [];
    
    // Filter out leads without email (this is always enforced)
    const validLeads = leads.filter((lead: any) => lead.email && lead.email.trim() !== '');
    
    console.log(`✅ Successfully fetched ${validLeads.length} valid leads (${leads.length} total)`);
    if (validLeads.length !== leads.length) {
      console.log(`⚠️  Filtered out ${leads.length - validLeads.length} leads without email`);
    }
    
    // Log applied filters for transparency
    if (params.segment_ids.length === 0 && params.status.length === 0) {
      console.log(`📋 Applied filters: Email required only (no segment/status filters)`);
    } else if (params.segment_ids.length === 0) {
      console.log(`📋 Applied filters: Email required + Status filter`);
    } else if (params.status.length === 0) {
      console.log(`📋 Applied filters: Email required + Segment filter`);
    } else {
      console.log(`📋 Applied filters: Email required + Segment filter + Status filter`);
    }
    
    return {
      success: true,
      leads: validLeads,
      total: validLeads.length
    };
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Exception fetching leads:`, errorMessage);
    
    return {
      success: false,
      leads: [],
      total: 0,
      error: errorMessage
    };
  }
}

/**
 * Activity to send newsletter emails to leads
 */
export async function sendNewsletterEmailActivity(
  params: SendNewsletterEmailParams
): Promise<SendNewsletterEmailResult> {
  console.log(`📧 Sending newsletter to ${params.leads.length} leads`);
  console.log(`   - Subject: ${params.subject}`);
  console.log(`   - Max emails: ${params.maxEmails || 500}`);
  
  const results: any[] = [];
  let emailsSent = 0;
  let emailsFailed = 0;
  const maxEmails = params.maxEmails || 500;
  
  try {
    // Limit leads to maxEmails
    const leadsToProcess = params.leads.slice(0, maxEmails);
    
    console.log(`📤 Processing ${leadsToProcess.length} leads for newsletter sending`);
    
    // Send emails one by one using the existing sendEmailFromAgent workflow
    for (const lead of leadsToProcess) {
      try {
        console.log(`📧 Sending email to: ${lead.email} (${lead.name || 'Unknown Name'})`);
        
        // Import the workflow function here to avoid circular imports
        const { sendEmailFromAgent } = await import('../workflows/sendEmailFromAgentWorkflow');
        
        // Send email using the existing workflow
        const emailResult = await sendEmailFromAgent({
          email: lead.email,
          subject: params.subject,
          message: params.message,
          site_id: params.site_id,
          lead_id: lead.id,
          from: undefined // Will use default from agent
        });
        
        results.push({
          lead_id: lead.id,
          email: lead.email,
          name: lead.name,
          success: emailResult.success,
          messageId: emailResult.messageId,
          timestamp: emailResult.timestamp
        });
        
        emailsSent++;
        console.log(`✅ Email sent successfully to ${lead.email}`);
        
      } catch (emailError) {
        const errorMessage = emailError instanceof Error ? emailError.message : String(emailError);
        console.error(`❌ Failed to send email to ${lead.email}:`, errorMessage);
        
        results.push({
          lead_id: lead.id,
          email: lead.email,
          name: lead.name,
          success: false,
          error: errorMessage,
          timestamp: new Date().toISOString()
        });
        
        emailsFailed++;
      }
    }
    
    console.log(`📊 Newsletter sending completed:`);
    console.log(`   - Emails sent: ${emailsSent}`);
    console.log(`   - Emails failed: ${emailsFailed}`);
    console.log(`   - Total processed: ${leadsToProcess.length}`);
    
    return {
      success: true,
      emailsSent,
      emailsFailed,
      results
    };
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Exception sending newsletter emails:`, errorMessage);
    
    return {
      success: false,
      emailsSent,
      emailsFailed,
      results,
      error: errorMessage
    };
  }
} 