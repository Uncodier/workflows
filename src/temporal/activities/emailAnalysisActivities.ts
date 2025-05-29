/**
 * Email Analysis Activities
 * Activities for calling external email analysis API
 */

export interface EmailAnalysisRequest {
  site_id: string;
  limit?: number;
  agentId?: string;
  lead_id?: string;
  user_id?: string;
  team_member_id?: string;
  analysis_type?: string;
}

export interface EmailAnalysisResponse {
  success: boolean;
  data?: {
    commandId: string;
    status: string;
    message: string;
    emailCount: number;
  };
  error?: {
    code: string;
    message: string;
  };
}

/**
 * Activity to analyze emails using external API
 */
export async function analyzeEmailsActivity(
  request: EmailAnalysisRequest
): Promise<EmailAnalysisResponse> {
  const API_BASE_URL = process.env.API_BASE_URL;
  
  if (!API_BASE_URL) {
    throw new Error('API_BASE_URL environment variable is not configured');
  }

  const url = `${API_BASE_URL.replace(/\/$/, '')}/api/agents/email`;
  
  console.log(`🔍 Analyzing emails for site ${request.site_id}`);
  console.log(`📡 Calling: ${url}`);
  console.log(`📋 Request:`, JSON.stringify(request, null, 2));

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API call failed with status ${response.status}: ${errorText}`);
    }

    const result: EmailAnalysisResponse = await response.json();
    
    console.log(`✅ Email analysis API response:`, JSON.stringify(result, null, 2));
    
    return result;

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Email analysis failed: ${errorMessage}`);
    
    throw new Error(`Email analysis activity failed: ${errorMessage}`);
  }
}

/**
 * Activity to check email analysis command status
 */
export async function checkEmailAnalysisStatusActivity(
  commandId: string
): Promise<any> {
  const API_BASE_URL = process.env.API_BASE_URL;
  
  if (!API_BASE_URL) {
    throw new Error('API_BASE_URL environment variable is not configured');
  }

  const url = `${API_BASE_URL.replace(/\/$/, '')}/api/commands/${commandId}`;
  
  console.log(`🔍 Checking command status: ${commandId}`);
  console.log(`📡 Calling: ${url}`);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API call failed with status ${response.status}: ${errorText}`);
    }

    const result = await response.json();
    
    console.log(`✅ Command status response:`, JSON.stringify(result, null, 2));
    
    return result;

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Command status check failed: ${errorMessage}`);
    
    throw new Error(`Command status check failed: ${errorMessage}`);
  }
} 