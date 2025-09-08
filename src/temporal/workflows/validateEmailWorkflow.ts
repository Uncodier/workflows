import { proxyActivities } from '@temporalio/workflow';
import type * as activities from '../activities/validateEmailActivities';

const {
  testSMTPConnectivityActivity,
  validateEmail
} = proxyActivities<typeof activities>({
  startToCloseTimeout: '10 minutes',
  retry: {
    initialInterval: '1 second',
    maximumInterval: '30 seconds',
    backoffCoefficient: 2,
    maximumAttempts: 3
  }
});

export interface ValidateEmailWorkflowInput {
  email: string;
  aggressiveMode?: boolean;
}

export interface ValidateEmailWorkflowResult {
  success: boolean;
  data?: {
    email: string;
    isValid: boolean;
    deliverable: boolean;
    result: 'valid' | 'invalid' | 'unknown' | 'disposable' | 'catchall' | 'risky';
    flags: string[];
    suggested_correction: string | null;
    execution_time: number;
    message: string;
    timestamp: string;
    bounceRisk: 'low' | 'medium' | 'high';
    reputationFlags: string[];
    riskFactors: string[];
    confidence: number;
    confidenceLevel: 'low' | 'medium' | 'high' | 'very_high';
    reasoning: string[];
    aggressiveMode: boolean;
    fallbackValidation?: any;
  };
  error?: {
    code: string;
    message: string;
    details: string;
  };
}

/**
 * Email validation workflow that runs on Render to bypass Vercel port 25 restrictions
 * 
 * This workflow provides comprehensive email validation including:
 * - Format validation
 * - Domain existence checks
 * - MX record validation
 * - SMTP validation with port 25 access
 * - Disposable email detection
 * - Catchall domain detection
 * - Bounce risk assessment
 * - Fallback validation methods
 */
export async function validateEmailWorkflow(
  input: ValidateEmailWorkflowInput
): Promise<ValidateEmailWorkflowResult> {
  console.log(`[VALIDATE_EMAIL_WORKFLOW] Starting email validation for: ${input.email} (aggressive: ${input.aggressiveMode || false})`);
  
  try {
    // First, ensure SMTP connectivity over port 25 is available and visible in history
    const connectivity = await testSMTPConnectivityActivity({
      email: input.email
    });
    if (!connectivity.success) {
      console.error(`[VALIDATE_EMAIL_WORKFLOW] SMTP connectivity failed for ${input.email}:`, connectivity);
      return {
        success: false,
        error: {
          code: connectivity.errorCode || 'SMTP_CONNECT_FAILED',
          message: 'SMTP connectivity failed',
          details: connectivity.error || connectivity.message
        }
      };
    }

    // Execute the email validation activity
    const result = await validateEmail({
      email: input.email,
      aggressiveMode: input.aggressiveMode || false
    });
    
    console.log(`[VALIDATE_EMAIL_WORKFLOW] Validation completed for ${input.email}:`, {
      success: result.success,
      isValid: result.data?.isValid,
      deliverable: result.data?.deliverable,
      result: result.data?.result,
      confidence: result.data?.confidence,
      executionTime: result.data?.execution_time
    });
    
    return result;
    
  } catch (error: any) {
    console.error(`[VALIDATE_EMAIL_WORKFLOW] Workflow failed for ${input.email}:`, error);
    
    return {
      success: false,
      error: {
        code: 'WORKFLOW_ERROR',
        message: 'Email validation workflow failed',
        details: error.message || 'Unknown workflow error'
      }
    };
  }
}
