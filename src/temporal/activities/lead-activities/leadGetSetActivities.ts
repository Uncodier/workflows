/**
 * Lead Get/Set Activities
 * Activities for getting and setting lead information
 */

import { getSupabaseService } from '../../services/supabaseService';

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
  assignee_id?: string;
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

export async function invalidateLeadActivity(request: {
  lead_id: string;
  original_site_id: string;
  reason: string;
  failed_contact?: {
    telephone?: string;
    email?: string;
  };
  userId?: string;
  shared_with_lead_id?: string;
  response_message?: string; // New parameter for the message that will be concatenated to notes
}): Promise<{ success: boolean; error?: string }> {
  console.log(`🚫 Invalidating lead ${request.lead_id} - reason: ${request.reason}`);
  
  try {
    const supabaseService = getSupabaseService();
    
    console.log('🔍 Checking database connection...');
    const isConnected = await supabaseService.getConnectionStatus();
    
    if (!isConnected) {
      console.log('⚠️  Database not available, cannot invalidate lead');
      return {
        success: false,
        error: 'Database not available'
      };
    }

    console.log('✅ Database connection confirmed, invalidating lead...');
    
    // Import supabase service role client (bypasses RLS)
    const { supabaseServiceRole } = await import('../../../lib/supabase/client');

    // First get current lead data to preserve existing notes
    console.log(`📝 Fetching current lead data to preserve existing notes...`);
    const { data: currentLead, error: fetchError } = await supabaseServiceRole
      .from('leads')
      .select('notes')
      .eq('id', request.lead_id)
      .single();

    if (fetchError) {
      console.error(`❌ Error fetching current lead data:`, fetchError);
      return {
        success: false,
        error: fetchError.message
      };
    }

    // Only add metadata for email_failed or whatsapp_failed reasons
    const shouldAddMetadata = request.reason === 'email_failed' || request.reason === 'whatsapp_failed';
    
    const updateData: any = {
      site_id: null, // Remove site_id to remove lead from site
      updated_at: new Date().toISOString()
    };

    // Handle notes concatenation if response_message is provided
    if (request.response_message) {
      const invalidationNote = "Lead invalidated due to invalid email and no WhatsApp available (early validation)";
      const existingNotes = currentLead.notes || '';
      
      // Concatenate existing notes with invalidation note and response message
      if (existingNotes.trim()) {
        updateData.notes = `${existingNotes}\n\n${invalidationNote}\n${request.response_message}`;
      } else {
        updateData.notes = `${invalidationNote}\n${request.response_message}`;
      }
      
      console.log(`📝 Concatenating notes:`);
      console.log(`   - Existing notes: ${existingNotes ? '"' + existingNotes.substring(0, 100) + '..."' : 'None'}`);
      console.log(`   - Adding invalidation note: "${invalidationNote}"`);
      console.log(`   - Adding response message: "${request.response_message}"`);
    }

    if (shouldAddMetadata) {
      // Prepare invalidation metadata only for communication failures
      const invalidationMetadata: any = {
        invalidated: true,
        invalidated_at: new Date().toISOString(),
        invalidation_reason: request.reason,
        original_site_id: request.original_site_id,
        pending_revalidation: true,
        failed_contact: request.failed_contact || {},
        invalidated_by_user_id: request.userId,
      };

      // If this is a shared contact invalidation, add reference
      if (request.shared_with_lead_id) {
        invalidationMetadata.shared_with_lead_id = request.shared_with_lead_id;
      }

      updateData.metadata = invalidationMetadata;
      console.log(`📝 Adding invalidation metadata for ${request.reason}`);
    } else {
      console.log(`📋 Reason '${request.reason}' - only removing site_id, no metadata added`);
    }

    const { data, error } = await supabaseServiceRole
      .from('leads')
      .update(updateData)
      .eq('id', request.lead_id)
      .select()
      .single();

    if (error) {
      console.error(`❌ Error invalidating lead ${request.lead_id}:`, error);
      return {
        success: false,
        error: error.message
      };
    }

    if (!data) {
      return {
        success: false,
        error: `Lead ${request.lead_id} not found or update failed`
      };
    }

    console.log(`✅ Successfully invalidated lead ${request.lead_id}`);
    console.log(`📝 Invalidation metadata added to lead`);
    
    return {
      success: true
    };
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Exception invalidating lead ${request.lead_id}:`, errorMessage);
    
    return {
      success: false,
      error: errorMessage
    };
  }
}

/**
 * Activity to invalidate only email from a lead (when lead has alternative contact methods like WhatsApp)
 * This removes only the email field but keeps the site_id
 */
export async function invalidateEmailOnlyActivity(request: {
  lead_id: string;
  failed_email: string;
  userId?: string;
}): Promise<{ success: boolean; error?: string }> {
  console.log(`📧🚫 Invalidating only email for lead ${request.lead_id} - email: ${request.failed_email}`);
  
  try {
    const supabaseService = getSupabaseService();
    
    console.log('🔍 Checking database connection...');
    const isConnected = await supabaseService.getConnectionStatus();
    
    if (!isConnected) {
      console.log('⚠️  Database not available, cannot invalidate email');
      return {
        success: false,
        error: 'Database not available'
      };
    }

    console.log('✅ Database connection confirmed, invalidating email only...');
    
    // Import supabase service role client (bypasses RLS)
    const { supabaseServiceRole } = await import('../../../lib/supabase/client');

    // Only remove the email field, keep site_id and other data
    const updateData: any = {
      email: null, // Remove invalid email
      updated_at: new Date().toISOString()
    };

    const { data, error } = await supabaseServiceRole
      .from('leads')
      .update(updateData)
      .eq('id', request.lead_id)
      .select()
      .single();

    if (error) {
      console.error(`❌ Error invalidating email for lead ${request.lead_id}:`, error);
      return {
        success: false,
        error: error.message
      };
    }

    if (!data) {
      return {
        success: false,
        error: `Lead ${request.lead_id} not found or update failed`
      };
    }

    console.log(`✅ Successfully invalidated email for lead ${request.lead_id}`);
    console.log(`📝 Email removed, site_id preserved: ${data.site_id}`);
    
    return {
      success: true
    };
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Exception invalidating email for lead ${request.lead_id}:`, errorMessage);
    
    return {
      success: false,
      error: errorMessage
    };
  }
}

/**
 * Activity to find leads that share the same contact information
 */
export async function findLeadsBySharedContactActivity(request: {
  email?: string;
  telephone?: string;
  exclude_lead_id?: string;
  site_id?: string;
}): Promise<{ success: boolean; leads?: any[]; error?: string }> {
  console.log(`🔍 Finding leads with shared contact information...`);
  console.log(`📧 Email: ${request.email || 'N/A'}`);
  console.log(`📞 Phone: ${request.telephone || 'N/A'}`);
  console.log(`🚫 Excluding lead: ${request.exclude_lead_id || 'N/A'}`);
  
  try {
    const supabaseService = getSupabaseService();
    
    console.log('🔍 Checking database connection...');
    const isConnected = await supabaseService.getConnectionStatus();
    
    if (!isConnected) {
      console.log('⚠️  Database not available, cannot search for shared leads');
      return {
        success: false,
        error: 'Database not available'
      };
    }

    console.log('✅ Database connection confirmed, searching for shared contact leads...');
    
    // Import supabase service role client (bypasses RLS)
    const { supabaseServiceRole } = await import('../../../lib/supabase/client');

    if (!request.email && !request.telephone) {
      console.log('⚠️ No contact information provided for search');
      return {
        success: true,
        leads: []
      };
    }

    let query = supabaseServiceRole
      .from('leads')
      .select('id, name, email, phone, site_id, status, metadata');

    // Build OR condition for shared contact
    const orConditions: string[] = [];
    
    if (request.email) {
      orConditions.push(`email.eq.${request.email}`);
    }
    
    if (request.telephone) {
      orConditions.push(`phone.eq.${request.telephone}`);
    }

    if (orConditions.length > 0) {
      query = query.or(orConditions.join(','));
    }

    // Exclude the original lead if specified
    if (request.exclude_lead_id) {
      query = query.neq('id', request.exclude_lead_id);
    }

    // Only search within the same site if specified
    if (request.site_id) {
      query = query.eq('site_id', request.site_id);
    }

    // Only include active leads (not already invalidated)
    query = query.neq('status', 'invalidated');

    const { data: leads, error } = await query;

    if (error) {
      console.error(`❌ Error searching for shared contact leads:`, error);
      return {
        success: false,
        error: error.message
      };
    }

    console.log(`✅ Found ${leads?.length || 0} leads with shared contact information`);
    
    if (leads && leads.length > 0) {
      console.log('📋 Shared contact leads:');
      leads.forEach((lead, index) => {
        console.log(`   ${index + 1}. ${lead.name || lead.email} (${lead.id}) - Site: ${lead.site_id}`);
      });
    }
    
    return {
      success: true,
      leads: leads || []
    };
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Exception searching for shared contact leads:`, errorMessage);
    
    return {
      success: false,
      error: errorMessage
    };
  }
}

/**
 * Activity to update lead invalidation metadata
 * This can be used for additional metadata updates after invalidation
 */
export async function updateLeadInvalidationMetadataActivity(request: {
  lead_id: string;
  additional_metadata: any;
}): Promise<{ success: boolean; error?: string }> {
  console.log(`📝 Updating invalidation metadata for lead ${request.lead_id}`);
  
  try {
    const supabaseService = getSupabaseService();
    
    console.log('🔍 Checking database connection...');
    const isConnected = await supabaseService.getConnectionStatus();
    
    if (!isConnected) {
      console.log('⚠️  Database not available, cannot update lead metadata');
      return {
        success: false,
        error: 'Database not available'
      };
    }

    console.log('✅ Database connection confirmed, updating lead metadata...');
    
    // Import supabase service role client (bypasses RLS)
    const { supabaseServiceRole } = await import('../../../lib/supabase/client');

    // First get current metadata
    const { data: currentLead, error: fetchError } = await supabaseServiceRole
      .from('leads')
      .select('metadata')
      .eq('id', request.lead_id)
      .single();

    if (fetchError) {
      console.error(`❌ Error fetching current lead metadata:`, fetchError);
      return {
        success: false,
        error: fetchError.message
      };
    }

    // Merge with additional metadata
    const updatedMetadata = {
      ...currentLead.metadata || {},
      ...request.additional_metadata,
      metadata_updated_at: new Date().toISOString()
    };

    // Update lead metadata
    const { data, error } = await supabaseServiceRole
      .from('leads')
      .update({
        metadata: updatedMetadata,
        updated_at: new Date().toISOString()
      })
      .eq('id', request.lead_id)
      .select()
      .single();

    if (error) {
      console.error(`❌ Error updating lead metadata:`, error);
      return {
        success: false,
        error: error.message
      };
    }

    if (!data) {
      return {
        success: false,
        error: `Lead ${request.lead_id} not found or update failed`
      };
    }

    console.log(`✅ Successfully updated invalidation metadata for lead ${request.lead_id}`);
    
    return {
      success: true
    };
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Exception updating lead invalidation metadata:`, errorMessage);
    
    return {
      success: false,
      error: errorMessage
    };
  }
} 

/**
 * Activity to update lead metadata with email verification status
 */
export async function updateLeadEmailVerificationActivity(request: {
  lead_id: string;
  emailVerified: boolean;
  validatedEmail?: string;
  userId?: string;
}): Promise<{ success: boolean; error?: string }> {
  console.log(`📧✅ Updating email verification status for lead ${request.lead_id}: ${request.emailVerified}`);
  
  try {
    const supabaseService = getSupabaseService();
    
    console.log('🔍 Checking database connection...');
    const isConnected = await supabaseService.getConnectionStatus();
    
    if (!isConnected) {
      console.log('⚠️  Database not available, cannot update email verification');
      return {
        success: false,
        error: 'Database not available'
      };
    }

    console.log('✅ Database connection confirmed, updating email verification status...');
    
    // Import supabase service role client (bypasses RLS)
    const { supabaseServiceRole } = await import('../../../lib/supabase/client');

    // Get current lead data to merge with existing metadata
    const { data: currentLead, error: fetchError } = await supabaseServiceRole
      .from('leads')
      .select('metadata, email')
      .eq('id', request.lead_id)
      .single();

    if (fetchError) {
      console.error(`❌ Error fetching current lead data: ${fetchError.message}`);
      return {
        success: false,
        error: fetchError.message
      };
    }

    // Prepare updated metadata
    const currentMetadata = currentLead?.metadata || {};
    const updatedMetadata = {
      ...currentMetadata,
      emailVerified: request.emailVerified,
      emailVerificationTimestamp: new Date().toISOString(),
      emailVerificationWorkflow: 'leadResearchWorkflow'
    };

    // If a validated email is provided and it's different from current, update it
    const updateData: any = {
      metadata: updatedMetadata,
      updated_at: new Date().toISOString()
    };

    if (request.validatedEmail && request.validatedEmail !== currentLead?.email) {
      updateData.email = request.validatedEmail;
      console.log(`📧 Updating email from ${currentLead?.email} to ${request.validatedEmail}`);
    }

    const { data, error } = await supabaseServiceRole
      .from('leads')
      .update(updateData)
      .eq('id', request.lead_id)
      .select()
      .single();

    if (error) {
      console.error(`❌ Error updating email verification for lead ${request.lead_id}:`, error);
      return {
        success: false,
        error: error.message
      };
    }

    if (!data) {
      return {
        success: false,
        error: `Lead ${request.lead_id} not found or update failed`
      };
    }

    console.log(`✅ Successfully updated email verification for lead ${request.lead_id}`);
    console.log(`📝 Email verified status: ${request.emailVerified}`);
    
    return {
      success: true
    };
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Exception updating email verification for lead ${request.lead_id}:`, errorMessage);
    
    return {
      success: false,
      error: errorMessage
    };
  }
}

/**
 * Activity to invalidate referred leads when a lead with referral_lead_id is invalidated
 * 
 * This activity:
 * 1. Finds all leads that have the same referral_lead_id as the invalidated lead
 * 2. Finds the referral lead itself (the lead that referral_lead_id points to)
 * 3. Invalidates only those leads that share the same email or phone as the original lead
 */
export async function invalidateReferredLeads(request: {
  lead_id: string;
  referral_lead_id: string;
  original_site_id: string;
  reason: string;
  original_email?: string;
  original_phone?: string;
  userId?: string;
  response_message?: string;
}): Promise<{ success: boolean; invalidated_leads: string[]; errors: string[] }> {
  console.log(`🔗 Invalidating referred leads for referral_lead_id: ${request.referral_lead_id}`);
  
  const invalidatedLeads: string[] = [];
  const errors: string[] = [];
  
  try {
    const supabaseService = getSupabaseService();
    
    console.log('🔍 Checking database connection...');
    const isConnected = await supabaseService.getConnectionStatus();
    
    if (!isConnected) {
      console.log('⚠️  Database not available, cannot invalidate referred leads');
      return {
        success: false,
        invalidated_leads: [],
        errors: ['Database not available']
      };
    }

    console.log('✅ Database connection confirmed, finding referred leads...');
    
    // Import supabase service role client (bypasses RLS)
    const { supabaseServiceRole } = await import('../../../lib/supabase/client');

    // Step 1: Find all leads with the same referral_lead_id (excluding the original lead)
    console.log(`🔍 Finding leads with referral_lead_id: ${request.referral_lead_id}...`);
    const { data: referredLeads, error: referredError } = await supabaseServiceRole
      .from('leads')
      .select('id, email, phone, site_id')
      .eq('referral_lead_id', request.referral_lead_id)
      .neq('id', request.lead_id) // Exclude the original invalidated lead
      .not('site_id', 'is', null); // Only get leads that are still active (have site_id)

    if (referredError) {
      console.error(`❌ Error finding referred leads:`, referredError);
      errors.push(`Failed to find referred leads: ${referredError.message}`);
    } else if (referredLeads && referredLeads.length > 0) {
      console.log(`📋 Found ${referredLeads.length} leads with same referral_lead_id`);
      
      // Filter leads that share the same email or phone as the original lead
      const leadsToInvalidate = referredLeads.filter(lead => {
        const sameEmail = request.original_email && lead.email === request.original_email;
        const samePhone = request.original_phone && lead.phone === request.original_phone;
        return sameEmail || samePhone;
      });
      
      console.log(`🎯 ${leadsToInvalidate.length} leads share contact info and will be invalidated`);
      
      // Invalidate each matching lead
      for (const leadToInvalidate of leadsToInvalidate) {
        try {
          console.log(`🚫 Invalidating referred lead ${leadToInvalidate.id}...`);
          
          const invalidationResult = await invalidateLeadActivity({
            lead_id: leadToInvalidate.id,
            original_site_id: leadToInvalidate.site_id,
            reason: `referral_${request.reason}`,
            failed_contact: {
              email: request.original_email,
              telephone: request.original_phone
            },
            userId: request.userId,
            shared_with_lead_id: request.lead_id,
            response_message: request.response_message ? 
              `${request.response_message} (referred lead invalidation)` : 
              undefined
          });
          
          if (invalidationResult.success) {
            invalidatedLeads.push(leadToInvalidate.id);
            console.log(`✅ Successfully invalidated referred lead ${leadToInvalidate.id}`);
          } else {
            const errorMsg = `Failed to invalidate referred lead ${leadToInvalidate.id}: ${invalidationResult.error}`;
            console.error(`❌ ${errorMsg}`);
            errors.push(errorMsg);
          }
        } catch (leadError) {
          const errorMessage = leadError instanceof Error ? leadError.message : String(leadError);
          console.error(`❌ Exception invalidating referred lead ${leadToInvalidate.id}:`, errorMessage);
          errors.push(`Exception invalidating referred lead ${leadToInvalidate.id}: ${errorMessage}`);
        }
      }
    } else {
      console.log(`ℹ️ No referred leads found with referral_lead_id: ${request.referral_lead_id}`);
    }

    // Step 2: Check and invalidate the referral lead itself if it shares contact info
    console.log(`🔍 Checking referral lead ${request.referral_lead_id}...`);
    const { data: referralLead, error: referralError } = await supabaseServiceRole
      .from('leads')
      .select('id, email, phone, site_id')
      .eq('id', request.referral_lead_id)
      .not('site_id', 'is', null) // Only if still active
      .single();

    if (referralError) {
      if (referralError.code === 'PGRST116') {
        console.log(`ℹ️ Referral lead ${request.referral_lead_id} not found or already invalidated`);
      } else {
        console.error(`❌ Error finding referral lead:`, referralError);
        errors.push(`Failed to find referral lead: ${referralError.message}`);
      }
    } else if (referralLead) {
      // Check if referral lead shares contact info with original lead
      const sameEmail = request.original_email && referralLead.email === request.original_email;
      const samePhone = request.original_phone && referralLead.phone === request.original_phone;
      
      if (sameEmail || samePhone) {
        console.log(`🎯 Referral lead ${request.referral_lead_id} shares contact info, invalidating...`);
        
        try {
          const referralInvalidationResult = await invalidateLeadActivity({
            lead_id: referralLead.id,
            original_site_id: referralLead.site_id,
            reason: `referral_source_${request.reason}`,
            failed_contact: {
              email: request.original_email,
              telephone: request.original_phone
            },
            userId: request.userId,
            shared_with_lead_id: request.lead_id,
            response_message: request.response_message ? 
              `${request.response_message} (referral source invalidation)` : 
              undefined
          });
          
          if (referralInvalidationResult.success) {
            invalidatedLeads.push(referralLead.id);
            console.log(`✅ Successfully invalidated referral lead ${referralLead.id}`);
          } else {
            const errorMsg = `Failed to invalidate referral lead ${referralLead.id}: ${referralInvalidationResult.error}`;
            console.error(`❌ ${errorMsg}`);
            errors.push(errorMsg);
          }
        } catch (referralLeadError) {
          const errorMessage = referralLeadError instanceof Error ? referralLeadError.message : String(referralLeadError);
          console.error(`❌ Exception invalidating referral lead ${referralLead.id}:`, errorMessage);
          errors.push(`Exception invalidating referral lead ${referralLead.id}: ${errorMessage}`);
        }
      } else {
        console.log(`ℹ️ Referral lead ${request.referral_lead_id} does not share contact info, skipping invalidation`);
      }
    }

    console.log(`🎉 Referred leads invalidation completed. Invalidated: ${invalidatedLeads.length}, Errors: ${errors.length}`);
    
    return {
      success: true,
      invalidated_leads: invalidatedLeads,
      errors
    };
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Exception in invalidateReferredLeads:`, errorMessage);
    
    return {
      success: false,
      invalidated_leads: invalidatedLeads,
      errors: [...errors, errorMessage]
    };
  }
}
