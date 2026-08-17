import axios from 'axios';
import {
  isValidEmailFormat,
  extractDomain
} from '../../lib/email-validation';

/**
 * Activity: Dummy connectivity check to avoid breaking existing workflow structure
 */
export async function testSMTPConnectivityActivity(input: {
  email: string;
  timeoutMs?: number;
}): Promise<{
  success: boolean;
  host?: string;
  message: string;
  error?: string;
  errorCode?: string;
}> {
  // Return success directly to bypass SMTP check
  return {
    success: true,
    message: 'SMTP check bypassed (using Reoon API)',
  };
}

export interface ValidateEmailInput {
  email: string;
  aggressiveMode?: boolean;
}

export interface ValidateEmailOutput {
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
 * Validates an email address using Reoon Email Verifier API
 */
export async function validateEmail(input: ValidateEmailInput): Promise<ValidateEmailOutput> {
  const startTime = Date.now();
  
  try {
    console.log(`[VALIDATE_EMAIL] 🚀 Starting email validation process using Reoon API`);
    
    const { email, aggressiveMode = false } = input;
    
    // Validate that email is provided
    if (!email) {
      return {
        success: false,
        error: {
          code: 'EMAIL_REQUIRED',
          message: 'Email is required',
          details: 'Please provide an email address to validate'
        }
      };
    }
    
    console.log(`[VALIDATE_EMAIL] 📧 Validating email: ${email}`);
    
    // Basic format validation
    if (!isValidEmailFormat(email)) {
      const executionTime = Date.now() - startTime;
      return {
        success: true,
        data: {
          email,
          isValid: false,
          deliverable: false,
          result: 'invalid',
          flags: ['invalid_format'],
          suggested_correction: null,
          execution_time: executionTime,
          message: 'Invalid email format',
          timestamp: new Date().toISOString(),
          bounceRisk: 'high',
          reputationFlags: ['invalid_format'],
          riskFactors: ['invalid_format'],
          confidence: 95,
          confidenceLevel: 'very_high',
          reasoning: ['Invalid email format (-95)'],
          aggressiveMode
        }
      };
    }

    const domain = extractDomain(email);
    console.log(`[VALIDATE_EMAIL] 🌐 Domain extracted: ${domain}`);

    // Call Reoon API
    const apiKey = process.env.REOON_API_KEY;
    
    if (!apiKey) {
      console.warn(`[VALIDATE_EMAIL] ⚠️ REOON_API_KEY not found. Returning unknown status.`);
      return {
        success: false,
        error: {
          code: 'MISSING_API_KEY',
          message: 'Reoon API key is not configured',
          details: 'Please set the REOON_API_KEY environment variable'
        }
      };
    }

    // Call Reoon using axios
    console.log(`[VALIDATE_EMAIL] 📡 Requesting validation from Reoon API...`);
    const reoonResponse = await axios.get(`https://emailverifier.reoon.com/api/v1/verify`, {
      params: {
        email,
        key: apiKey,
        mode: 'power' // Deep SMTP validation
      },
      timeout: 15000 // 15 seconds timeout
    });

    const data = reoonResponse.data;
    const executionTime = Date.now() - startTime;
    
    console.log(`[VALIDATE_EMAIL] 📥 Reoon API response:`, JSON.stringify(data));

    if (data.status === 'error') {
      return {
        success: false,
        error: {
          code: 'API_ERROR',
          message: data.reason || 'Unknown API error',
          details: 'Reoon API returned an error'
        }
      };
    }

    // Map Reoon statuses to our internal format
    // Reoon statuses: safe, role, catch_all, disposable, spamtrap, invalid, unknown
    let isValid = false;
    let deliverable = false;
    let result: 'valid' | 'invalid' | 'unknown' | 'disposable' | 'catchall' | 'risky' = 'unknown';
    let bounceRisk: 'low' | 'medium' | 'high' = 'high';
    
    switch (data.status) {
      case 'safe':
        isValid = true;
        deliverable = true;
        result = 'valid';
        bounceRisk = 'low';
        break;
      case 'role':
        isValid = true;
        deliverable = true; // Technically deliverable, but risky for cold outreach
        result = 'valid';
        bounceRisk = 'medium';
        break;
      case 'catch_all':
        isValid = true;
        deliverable = true; 
        result = 'catchall';
        bounceRisk = 'medium'; // Could be higher risk
        break;
      case 'disposable':
        isValid = false;
        deliverable = false;
        result = 'disposable';
        bounceRisk = 'high';
        break;
      case 'spamtrap':
      case 'invalid':
        isValid = false;
        deliverable = false;
        result = 'invalid';
        bounceRisk = 'high';
        break;
      case 'unknown':
      default:
        isValid = false; // We can't guarantee it
        deliverable = false;
        result = 'unknown';
        bounceRisk = 'high';
        break;
    }

    // For unknown status, return success:false so fallback logic in other systems might trigger
    if (result === 'unknown') {
       return {
         success: false,
         error: {
            code: 'UNKNOWN_STATUS',
            message: 'Email verifier returned unknown status',
            details: 'Credit was automatically refunded by provider'
         }
       };
    }

    return {
      success: true,
      data: {
        email,
        isValid,
        deliverable,
        result,
        flags: [data.status],
        suggested_correction: null, // Reoon doesn't provide this in simple mode
        execution_time: executionTime,
        message: `Validation completed with status: ${data.status}`,
        timestamp: new Date().toISOString(),
        bounceRisk,
        reputationFlags: [],
        riskFactors: data.status !== 'safe' ? [data.status] : [],
        confidence: result === 'valid' ? 95 : (result === 'invalid' ? 95 : 50),
        confidenceLevel: result === 'valid' ? 'very_high' : (result === 'invalid' ? 'very_high' : 'medium'),
        reasoning: [`Reoon API status: ${data.status}`],
        aggressiveMode
      }
    };

  } catch (error: any) {
    console.error(`[VALIDATE_EMAIL] ❌ Unexpected error during validation:`, error);
    
    // Handle Axios timeout or network errors
    if (error.code === 'ECONNABORTED' || error.response?.status === 504) {
      return {
        success: false,
        error: {
          code: 'API_TIMEOUT',
          message: 'Email verification API timed out',
          details: error.message
        }
      };
    }

    return {
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'An unexpected error occurred during validation',
        details: error instanceof Error ? error.message : String(error)
      }
    };
  }
}
