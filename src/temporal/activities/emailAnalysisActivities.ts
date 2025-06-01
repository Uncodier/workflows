/**
 * Email Analysis Activities
 * Activities for calling external email analysis API
 */

import { apiService } from '../services/apiService';

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
    analysisCount: number;
    emails: any[];
    childWorkflow?: {
      type: string;
      args: any;
    };
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
  console.log(`🔍 Analyzing emails for site ${request.site_id}`);
  console.log(`📋 Request:`, JSON.stringify(request, null, 2));

  try {
    const response = await apiService.post('/api/agents/email', request);

    if (!response.success) {
      console.error(`❌ Email analysis failed:`, response.error);
      return {
        success: false,
        error: {
          code: response.error?.code || 'API_ERROR',
          message: response.error?.message || 'Unknown API error'
        }
      };
    }

    console.log(`✅ Email analysis completed successfully`);
    
    return {
      success: true,
      data: response.data
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Email analysis failed: ${errorMessage}`);
    
    return {
      success: false,
      error: {
        code: 'ACTIVITY_ERROR',
        message: `Email analysis activity failed: ${errorMessage}`
      }
    };
  }
}

/**
 * Activity to check email analysis command status
 */
export async function checkEmailAnalysisStatusActivity(
  commandId: string
): Promise<any> {
  console.log(`🔍 Checking command status: ${commandId}`);

  try {
    const response = await apiService.get(`/api/commands/${commandId}`);

    if (!response.success) {
      console.error(`❌ Command status check failed:`, response.error);
      throw new Error(`Command status check failed: ${response.error?.message}`);
    }

    console.log(`✅ Command status retrieved successfully`);
    return response.data;

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Command status check failed: ${errorMessage}`);
    throw new Error(`Command status check failed: ${errorMessage}`);
  }
} 