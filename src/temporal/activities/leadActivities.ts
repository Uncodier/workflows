/**
 * Lead and Company Activities
 * Activities for managing leads and companies
 */

import { apiService } from '../services/apiService';
import { getSupabaseService } from '../services/supabaseService';

// Lead interfaces
export interface Lead {
  id: string;
  email?: string;
  name?: string;
  company?: string;
  company_name?: string;
  job_title?: string;
  position?: string;
  industry?: string;
  location?: string;
  phone?: string;
  website?: string;
  company_size?: string;
  site_id: string;
  created_at: string;
  updated_at: string;
  [key: string]: any;
}

export interface GetLeadResult {
  success: boolean;
  lead?: Lead;
  error?: string;
}

/**
 * Activity to get lead information from database
 */
export async function getLeadActivity(leadId: string): Promise<GetLeadResult> {
  console.log(`👤 Getting lead information for: ${leadId}`);
  
  try {
    const supabaseService = getSupabaseService();
    
    console.log('🔍 Checking database connection...');
    const isConnected = await supabaseService.getConnectionStatus();
    
    if (!isConnected) {
      console.log('⚠️  Database not available, cannot fetch lead information');
      return {
        success: false,
        error: 'Database not available'
      };
    }

    console.log('✅ Database connection confirmed, fetching lead...');
    
    const leadData = await supabaseService.fetchLead(leadId);

    const lead: Lead = {
      id: leadData.id,
      email: leadData.email,
      name: leadData.name || leadData.full_name,
      company: leadData.company || leadData.company_name,
      company_name: leadData.company_name || leadData.company,
      job_title: leadData.job_title || leadData.position,
      position: leadData.position || leadData.job_title,
      industry: leadData.industry,
      location: leadData.location,
      phone: leadData.phone,
      website: leadData.website,
      company_size: leadData.company_size,
      site_id: leadData.site_id,
      created_at: leadData.created_at,
      updated_at: leadData.updated_at,
      ...leadData
    };

    console.log(`✅ Retrieved lead information for ${lead.name || lead.email}: ${lead.company}`);
    
    return {
      success: true,
      lead
    };
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Exception getting lead ${leadId}:`, errorMessage);
    
    return {
      success: false,
      error: errorMessage
    };
  }
}

// Lead follow-up interfaces
export interface LeadFollowUpRequest {
  lead_id: string;
  site_id: string;
  userId?: string;
  additionalData?: any;
}

export interface LeadFollowUpResult {
  success: boolean;
  data?: any;
  error?: string;
  followUpActions?: any[];
  nextSteps?: string[];
}

// Lead research interfaces
export interface LeadResearchRequest {
  lead_id: string;
  site_id: string;
  userId?: string;
  additionalData?: any;
}

export interface LeadResearchResult {
  success: boolean;
  data?: any;
  error?: string;
  researchData?: any;
  insights?: any[];
  recommendations?: string[];
}

/**
 * Activity to execute lead follow-up via sales agent API
 */
export async function leadFollowUpActivity(request: LeadFollowUpRequest): Promise<LeadFollowUpResult> {
  console.log(`📞 Executing lead follow-up for lead: ${request.lead_id}, site: ${request.site_id}`);
  
  try {
    const requestBody = {
      leadId: request.lead_id,        // Convert to camelCase for API
      siteId: request.site_id,        // Convert to camelCase for API
      userId: request.userId,
      ...request.additionalData,
    };

    console.log('📤 Sending lead follow-up request:', JSON.stringify(requestBody, null, 2));
    
    const response = await apiService.post('/api/agents/sales/leadFollowUp', requestBody);
    
    if (!response.success) {
      console.error(`❌ Failed to execute lead follow-up for lead ${request.lead_id}:`, response.error);
      return {
        success: false,
        error: response.error?.message || 'Failed to execute lead follow-up'
      };
    }
    
    const data = response.data;
    const followUpActions = data?.followUpActions || data?.actions || [];
    const nextSteps = data?.nextSteps || data?.next_steps || [];
    
    console.log(`✅ Lead follow-up executed successfully for lead ${request.lead_id}`);
    if (followUpActions.length > 0) {
      console.log(`📋 Follow-up actions generated: ${followUpActions.length}`);
    }
    if (nextSteps.length > 0) {
      console.log(`🎯 Next steps identified: ${nextSteps.length}`);
    }
    
    return {
      success: true,
      data,
      followUpActions,
      nextSteps
    };
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Exception executing lead follow-up for lead ${request.lead_id}:`, errorMessage);
    
    return {
      success: false,
      error: errorMessage
    };
  }
}

/**
 * Activity to execute lead research via sales agent API
 */
export async function leadResearchActivity(request: LeadResearchRequest): Promise<LeadResearchResult> {
  console.log(`🔍 Executing lead research for lead: ${request.lead_id}, site: ${request.site_id}`);
  
  try {
    const requestBody = {
      leadId: request.lead_id,        // Convert to camelCase for API
      siteId: request.site_id,        // Convert to camelCase for API
      userId: request.userId,
      ...request.additionalData,
    };

    console.log('📤 Sending lead research request:', JSON.stringify(requestBody, null, 2));
    
    const response = await apiService.post('/api/agents/sales/leadResearch', requestBody);
    
    if (!response.success) {
      console.error(`❌ Failed to execute lead research for lead ${request.lead_id}:`, response.error);
      return {
        success: false,
        error: response.error?.message || 'Failed to execute lead research'
      };
    }
    
    const data = response.data;
    const researchData = data?.researchData || data?.research || data;
    const insights = data?.insights || data?.findings || [];
    const recommendations = data?.recommendations || data?.next_steps || [];
    
    console.log(`✅ Lead research executed successfully for lead ${request.lead_id}`);
    if (insights.length > 0) {
      console.log(`🔍 Research insights generated: ${insights.length}`);
    }
    if (recommendations.length > 0) {
      console.log(`💡 Recommendations identified: ${recommendations.length}`);
    }
    
    return {
      success: true,
      data,
      researchData,
      insights,
      recommendations
    };
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Exception executing lead research for lead ${request.lead_id}:`, errorMessage);
    
    return {
      success: false,
      error: errorMessage
    };
  }
}

/**
 * Activity to save lead follow-up logs via API
 */
export async function saveLeadFollowUpLogsActivity(request: {
  siteId: string;
  leadId: string;
  userId: string;
  data: any;
}): Promise<{ success: boolean; error?: string }> {
  console.log(`📝 Saving lead follow-up logs for lead ${request.leadId} on site ${request.siteId}`);
  
  try {
    // Extract the nested data fields to flatten them at root level
    const { success, data: nestedData } = request.data;
    
    const requestBody = {
      siteId: request.siteId,
      leadId: request.leadId,
      userId: request.userId,
      success,
      ...nestedData  // Flatten the nested data fields (messages, lead, command_ids) to root
    };
    
    console.log('📤 Sending lead follow-up logs:', JSON.stringify(requestBody, null, 2));
    
    const response = await apiService.post('/api/agents/sales/leadFollowUp/logs', requestBody);
    
    if (!response.success) {
      console.error(`❌ Failed to save lead follow-up logs:`, response.error);
      return {
        success: false,
        error: response.error?.message || 'Failed to save lead follow-up logs'
      };
    }
    
    console.log(`✅ Lead follow-up logs saved successfully`);
    
    return {
      success: true
    };
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Exception saving lead follow-up logs:`, errorMessage);
    
    return {
      success: false,
      error: errorMessage
    };
  }
}

// Update Lead interfaces
export interface UpdateLeadRequest {
  lead_id: string;
  updateData: any;
  safeUpdate?: boolean; // If true, will not update email or phone
}

export interface UpdateLeadResult {
  success: boolean;
  lead?: any;
  error?: string;
}

/**
 * Activity to update lead information in database
 */
export async function updateLeadActivity(request: UpdateLeadRequest): Promise<UpdateLeadResult> {
  console.log(`👤 Updating lead information for: ${request.lead_id}`);
  
  try {
    const supabaseService = getSupabaseService();
    
    console.log('🔍 Checking database connection...');
    const isConnected = await supabaseService.getConnectionStatus();
    
    if (!isConnected) {
      console.log('⚠️  Database not available, cannot update lead information');
      return {
        success: false,
        error: 'Database not available'
      };
    }

    console.log('✅ Database connection confirmed, updating lead...');
    
    // Prepare update data, excluding dangerous fields if safeUpdate is true
    let updateData = { ...request.updateData };
    
    if (request.safeUpdate !== false) { // Default to safe update
      // Remove dangerous fields that should not be overwritten
      const { email, phone, ...safeData } = updateData;
      updateData = safeData;
      
      if (email || phone) {
        console.log('⚠️  Skipping email/phone update for safety (safeUpdate mode)');
        console.log(`   - Email: ${email ? 'would be updated' : 'not provided'}`);
        console.log(`   - Phone: ${phone ? 'would be updated' : 'not provided'}`);
      }
    }
    
    const updatedLead = await supabaseService.updateLead(request.lead_id, updateData);

    console.log(`✅ Successfully updated lead information for ${request.lead_id}`);
    
    return {
      success: true,
      lead: updatedLead
    };
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Exception updating lead ${request.lead_id}:`, errorMessage);
    
    return {
      success: false,
      error: errorMessage
    };
  }
}

// Company interfaces
export interface GetCompanyResult {
  success: boolean;
  company?: any;
  error?: string;
}

export interface UpsertCompanyResult {
  success: boolean;
  company?: any;
  error?: string;
}

/**
 * Activity to get company information from database
 */
export async function getCompanyActivity(companyId: string): Promise<GetCompanyResult> {
  console.log(`🏢 Getting company information for: ${companyId}`);
  
  try {
    const supabaseService = getSupabaseService();
    
    console.log('🔍 Checking database connection...');
    const isConnected = await supabaseService.getConnectionStatus();
    
    if (!isConnected) {
      console.log('⚠️  Database not available, cannot fetch company information');
      return {
        success: false,
        error: 'Database not available'
      };
    }

    console.log('✅ Database connection confirmed, fetching company...');
    
    const companyData = await supabaseService.fetchCompany(companyId);

    if (!companyData) {
      console.log(`⚠️  Company ${companyId} not found`);
      return {
        success: false,
        error: 'Company not found'
      };
    }

    console.log(`✅ Retrieved company information for ${companyData.name}`);
    
    return {
      success: true,
      company: companyData
    };
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Exception getting company ${companyId}:`, errorMessage);
    
    return {
      success: false,
      error: errorMessage
    };
  }
}

/**
 * Activity to create or update company information in the database
 */
export async function upsertCompanyActivity(companyData: any): Promise<UpsertCompanyResult> {
  console.log(`🏢 Upserting company: ${companyData.name}`);
  console.log(`📋 Company data:`, JSON.stringify(companyData, null, 2));
  
  try {
    const supabaseService = getSupabaseService();
    
    console.log('🔍 Checking database connection...');
    const isConnected = await supabaseService.getConnectionStatus();
    
    if (!isConnected) {
      console.log('⚠️  Database not available, cannot upsert company');
      return {
        success: false,
        error: 'Database not available'
      };
    }

    console.log('✅ Database connection confirmed, upserting company...');
    
    const upsertedCompany = await supabaseService.upsertCompany(companyData);

    console.log(`✅ Successfully upserted company: ${upsertedCompany.name}`);
    
    return {
      success: true,
      company: upsertedCompany
    };
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Exception upserting company:`, errorMessage);
    
    return {
      success: false,
      error: errorMessage
    };
  }
} 