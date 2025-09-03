import { apiService } from '../services/apiService';

/**
 * Activity to fetch data from the API
 */
export async function fetchDataActivity(resourceId: string): Promise<any> {
  const response = await apiService.get(`/resources/${resourceId}`);
  
  if (!response.success) {
    throw new Error(`Failed to fetch resource ${resourceId}: ${response.error?.message}`);
  }
  
  return response.data;
}

/**
 * Activity to create a resource via the API
 */
export async function createApiResourceActivity(data: any): Promise<any> {
  const response = await apiService.post('/resources', data);
  
  if (!response.success) {
    throw new Error(`Failed to create resource: ${response.error?.message}`);
  }
  
  return response.data;
}

/**
 * Activity to update a resource via the API
 */
export async function updateApiResourceActivity(resourceId: string, data: any): Promise<any> {
  const response = await apiService.put(`/resources/${resourceId}`, data);
  
  if (!response.success) {
    throw new Error(`Failed to update resource ${resourceId}: ${response.error?.message}`);
  }
  
  return response.data;
}

/**
 * Activity to delete a resource via the API
 */
export async function deleteApiResourceActivity(resourceId: string): Promise<any> {
  const response = await apiService.delete(`/resources/${resourceId}`);
  
  if (!response.success) {
    throw new Error(`Failed to delete resource ${resourceId}: ${response.error?.message}`);
  }
  
  return response.data;
}

/**
 * Activity to validate contact information (email, phone, etc.)
 * Accepts context and handles all contact validation decisions internally
 */
export async function validateContactInformation(request: {
  email?: string;
  hasEmailMessage?: boolean;
  hasWhatsAppMessage?: boolean;
  leadId?: string;
  phone?: string;
  leadMetadata?: any; // Add metadata to check emailVerified flag
}): Promise<{
  success: boolean;
  isValid: boolean;
  result?: string;
  flags?: string[];
  suggested_correction?: string;
  execution_time?: number;
  message?: string;
  error?: string;
  shouldProceed: boolean;
  validationType: 'email' | 'whatsapp' | 'none';
  reason?: string;
}> {
  const { email, hasEmailMessage, hasWhatsAppMessage, leadId, phone, leadMetadata } = request;
  
  console.log(`🔍 Contact Information Validation Activity Started`);
  console.log(`📋 Context: lead=${leadId}, email=${email}, phone=${!!phone}`);
  console.log(`📨 Messages: email=${!!hasEmailMessage}, whatsapp=${!!hasWhatsAppMessage}`);
  console.log(`📦 Metadata emailVerified: ${leadMetadata?.emailVerified || false}`);
  
  // Check if email is already verified
  if (leadMetadata?.emailVerified && hasEmailMessage && email && email.trim() !== '') {
    console.log(`✅ Email already verified for lead ${leadId}, skipping validation`);
    return {
      success: true,
      isValid: true,
      shouldProceed: true,
      validationType: 'email',
      reason: 'Email already verified in metadata'
    };
  }
  
  // Always audit what's happening
  if (!hasEmailMessage && !hasWhatsAppMessage) {
    console.log(`⏭️ No messages to send - skipping all validation`);
    return {
      success: true,
      isValid: false,
      shouldProceed: false,
      validationType: 'none',
      reason: 'No messages available for sending'
    };
  }
  
  if (!hasEmailMessage) {
    console.log(`📱 Only WhatsApp message available - skipping email validation`);
    return {
      success: true,
      isValid: false,
      shouldProceed: true,
      validationType: 'whatsapp',
      reason: 'WhatsApp message only, no email validation needed'
    };
  }
  
  if (!email || email.trim() === '') {
    console.log(`❌ Email message exists but no email address found`);
    return {
      success: true,
      isValid: false,
      shouldProceed: false,
      validationType: 'email',
      reason: 'Email message exists but no email address provided'
    };
  }
  
  // Proceed with email validation
  console.log(`📧 Validating email: ${email}`);
  
  try {
    const response = await apiService.post('/api/agents/tools/validateEmail', { email });
    
    if (!response.success) {
      console.error(`❌ Email validation API call failed: ${response.error?.message}`);
      return {
        success: false,
        isValid: false,
        shouldProceed: true, // Proceed anyway when service fails
        validationType: 'email',
        error: response.error?.message || 'Email validation failed',
        reason: 'Validation service failed, proceeding with send'
      };
    }
    
    // Handle the new API response structure
    const data = response.data;
    console.log(`✅ Email validation response:`, data);
    console.log(`🔍 Full API response structure:`, JSON.stringify(response, null, 2));
    
    const isValid = Boolean(data.isValid); // Ensure proper boolean conversion
    const deliverable = data.deliverable !== undefined ? Boolean(data.deliverable) : true; // Default to true if not provided
    const hasWhatsApp = Boolean(phone && phone.trim() !== ''); // Ensure boolean type
    
    console.log(`📊 Validation result: isValid=${isValid}, deliverable=${deliverable}, hasWhatsApp=${hasWhatsApp}`);
    
    // SIMPLE RULE: If both isValid AND deliverable are true, always pass
    const emailIsGood = isValid && deliverable;
    console.log(`🔍 Email decision: emailIsGood=${emailIsGood} (isValid=${isValid} AND deliverable=${deliverable})`);
    
    return {
      success: true,
      isValid: emailIsGood, // Simple: true only if both isValid AND deliverable are true
      result: data.result,
      flags: data.flags,
      suggested_correction: data.suggested_correction,
      execution_time: data.execution_time,
      message: data.message,
      shouldProceed: emailIsGood || hasWhatsApp, // Proceed if email is good OR we have WhatsApp as backup
      validationType: 'email',
      reason: emailIsGood ? 
        'Email is valid and deliverable' : 
        (hasWhatsApp ? `Email ${!isValid ? 'invalid' : 'valid but not deliverable'} but WhatsApp available as backup` : `Email ${!isValid ? 'invalid' : 'valid but not deliverable'} and no WhatsApp backup`)
    };
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Exception during email validation: ${errorMessage}`);
    
    return {
      success: false,
      isValid: false,
      shouldProceed: true, // Proceed anyway when exception occurs
      validationType: 'email',
      error: errorMessage,
      reason: 'Validation exception, proceeding with send'
    };
  }
}

/**
 * Activity to generate contact information for leads without email
 * Calls the dataAnalyst leadContactGeneration API
 */
export async function leadContactGenerationActivity(request: {
  name: string;
  domain: string;
  context: string;
  site_id: string;
  leadId?: string;
}): Promise<{
  success: boolean;
  email_generation_analysis?: string[];
  emailAnalysisData?: {
    domain: string;
    contact_name: string;
    recommendations: string[];
    generated_emails: string[];
  };
  data?: any;
  error?: string;
}> {
  const { name, domain, context, site_id, leadId } = request;
  
  console.log(`🔍 Lead Contact Generation Activity Started`);
  console.log(`📋 Context: lead=${leadId}, name=${name}, domain=${domain}, site=${site_id}`);
  console.log(`📝 Context details: ${context}`);
  
  try {
    const response = await apiService.post('/api/agents/dataAnalyst/leadContactGeneration', {
      name,
      domain,
      context,
      site_id
    });
    
    if (!response.success) {
      console.error(`❌ Lead contact generation API call failed: ${response.error?.message}`);
      return {
        success: false,
        error: response.error?.message || 'Lead contact generation failed'
      };
    }
    
    // Handle case where API response wraps data in a 'data' property
    const data = response.data?.data || response.data;
    console.log(`✅ Lead contact generation response:`, data);
    
    // Extract emails from the new structure
    const emailAnalysis = data?.email_generation_analysis;
    const emailList = emailAnalysis?.generated_emails || [];
    
    console.log(`📧 Generated ${emailList.length} potential emails for ${emailAnalysis?.contact_name || 'contact'}`);
    if (emailAnalysis?.domain) {
      console.log(`🌐 Target domain: ${emailAnalysis.domain}`);
    }
    if (emailAnalysis?.recommendations && emailAnalysis.recommendations.length > 0) {
      console.log(`💡 AI Recommendations:`);
      emailAnalysis.recommendations.forEach((rec: string, index: number) => {
        console.log(`   ${index + 1}. ${rec}`);
      });
    }
    
    return {
      success: true,
      email_generation_analysis: emailList,
      emailAnalysisData: emailAnalysis,
      data: data
    };
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Exception during lead contact generation: ${errorMessage}`);
    
    return {
      success: false,
      error: errorMessage
    };
  }
}

/**
 * Activity to send daily stand up notification
 */
export async function sendDailyStandUpNotificationActivity(params: {
  site_id: string;
  subject: string;
  message: string;
  systemAnalysis?: any; // Optional system analysis data
}): Promise<any> {
  const { site_id, subject, message, systemAnalysis } = params;
  
  const response = await apiService.post('/api/notifications/dailyStandUp', {
    site_id,
    subject,
    message,
    systemAnalysis
  });
  
  if (!response.success) {
    throw new Error(`Failed to send daily stand up notification: ${response.error?.message}`);
  }
  
  return response.data;
}

/**
 * Activity to send project analysis notification
 */
export async function sendProjectAnalysisNotificationActivity(params: {
  site_id: string;
  insights?: Array<{
    title: string;
    description: string;
    type?: string;
    category?: string;
    order?: number;
  }>;
  deepResearchResult?: any;
  uxAnalysisResult?: any;
  settingsUpdates?: any;
}): Promise<{
  success: boolean;
  data?: any;
  error?: string;
}> {
  console.log(`📢 Sending project analysis notification for site: ${params.site_id}`);
  
  try {
    const requestBody = {
      site_id: params.site_id,
      insights: params.insights || [],
      deepResearchResult: params.deepResearchResult,
      uxAnalysisResult: params.uxAnalysisResult,
      settingsUpdates: params.settingsUpdates,
      timestamp: new Date().toISOString()
    };

    console.log('📤 Sending project analysis notification:', {
      site_id: params.site_id,
      insightsCount: params.insights ? params.insights.length : 0,
      hasDeepResearch: !!params.deepResearchResult,
      hasUxAnalysis: !!params.uxAnalysisResult,
      hasSettingsUpdates: !!params.settingsUpdates,
      settingsUpdateCount: params.settingsUpdates ? Object.keys(params.settingsUpdates).length : 0
    });

    const response = await apiService.post('/api/notifications/projectAnalysis', requestBody);
    
    if (!response.success) {
      console.error('❌ Project analysis notification failed:', response.error);
      return {
        success: false,
        error: response.error?.message || 'Failed to send project analysis notification'
      };
    }
    
    console.log('✅ Project analysis notification sent successfully');
    
    return {
      success: true,
      data: response.data
    };
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('❌ Project analysis notification exception:', errorMessage);
    
    return {
      success: false,
      error: errorMessage
    };
  }
} 