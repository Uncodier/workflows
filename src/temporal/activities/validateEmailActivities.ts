import axios from 'axios';
import { isValidEmailFormat } from '../../lib/email-validation';

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

// Prevent repeat verifications while the provider confirms there are no
// available credits. The cache is per key and per process; it expires after a
// minute, including after a key rotation.
const noCreditsUntil = new Map<string, number>();
const balanceChecks = new Map<string, Promise<boolean>>();

async function noReoonCredits(apiKey: string): Promise<boolean> {
  if (Date.now() < (noCreditsUntil.get(apiKey) || 0)) return true;
  let balanceCheck = balanceChecks.get(apiKey);
  if (!balanceCheck) {
    balanceCheck = (async () => {
      try {
        const response = await axios.get('https://emailverifier.reoon.com/api/v1/check-account-balance/', {
          params: { key: apiKey },
          timeout: 10000
        });
        const balance = response.data;
        const exhausted = balance?.status === 'success' && balance?.api_status === 'active' &&
          balance?.remaining_daily_credits === 0 && balance?.remaining_instant_credits === 0;
        if (exhausted) noCreditsUntil.set(apiKey, Date.now() + 60_000);
        return exhausted;
      } catch {
        // Never log this request or its exception: both may contain the key.
        return false;
      }
    })().finally(() => { balanceChecks.delete(apiKey); });
    balanceChecks.set(apiKey, balanceCheck);
  }
  return balanceCheck;
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
    
    console.log('[VALIDATE_EMAIL] Validating email');
    
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

    if (Date.now() < (noCreditsUntil.get(apiKey) || 0)) {
      return {
        success: false,
        error: {
          code: 'NO_CREDITS',
          message: 'Reoon has no available verification credits',
          details: 'Add verification credits before retrying'
        }
      };
    }

    // Call Reoon using axios
    console.log('[VALIDATE_EMAIL] Requesting validation from Reoon API');
    const reoonResponse = await axios.get(`https://emailverifier.reoon.com/api/v1/verify`, {
      params: {
        email,
        key: apiKey,
        mode: 'power' // Deep SMTP validation
      },
      // Power mode can take over a minute for some mail servers.
      timeout: 90000
    });

    const data = reoonResponse.data;
    const executionTime = Date.now() - startTime;
    
    const providerStatus = typeof data?.status === 'string' ? data.status : 'unrecognized';
    const documentedStatuses = [
      'safe', 'role', 'role_account', 'catch_all', 'inbox_full',
      'invalid', 'disabled', 'disposable', 'spamtrap', 'unknown', 'error'
    ];
    console.log('[VALIDATE_EMAIL] Reoon result category:', documentedStatuses.includes(providerStatus) ? providerStatus : 'unrecognized');

    if (providerStatus === 'error') {
      return {
        success: false,
        error: {
          code: 'API_ERROR',
          message: 'Reoon API returned an error',
          details: 'Reoon reported an API error; review the provider dashboard'
        }
      };
    }

    // Map Reoon statuses to our internal format
    // Power mode statuses: safe, role_account, catch_all, disposable,
    // spamtrap, invalid, disabled, inbox_full, unknown.
    let isValid = false;
    let deliverable = false;
    let result: 'valid' | 'invalid' | 'unknown' | 'disposable' | 'catchall' | 'risky' = 'unknown';
    let bounceRisk: 'low' | 'medium' | 'high' = 'high';
    
    switch (providerStatus) {
      case 'safe':
        isValid = data.is_deliverable === true;
        deliverable = isValid;
        result = 'valid';
        bounceRisk = 'low';
        break;
      case 'role':
      case 'role_account':
        isValid = data.is_deliverable === true;
        deliverable = isValid; // Deliverable shared inbox, not a personal mailbox
        result = 'valid';
        bounceRisk = 'medium';
        break;
      case 'catch_all':
        isValid = false;
        deliverable = false; // The individual mailbox cannot be confirmed
        result = 'catchall';
        bounceRisk = 'medium'; // Could be higher risk
        break;
      case 'inbox_full':
        isValid = false;
        deliverable = false; // Temporary condition: do not invalidate the lead
        result = 'risky';
        bounceRisk = 'high';
        break;
      case 'disposable':
        isValid = false;
        deliverable = false;
        result = 'disposable';
        bounceRisk = 'high';
        break;
      case 'spamtrap':
      case 'invalid':
      case 'disabled':
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

    // A contradictory safe/deliverable response must not invalidate a lead.
    if (result === 'unknown' || result === 'catchall' || result === 'risky' || (result === 'valid' && !deliverable)) {
      return {
        success: false,
        error: {
          code: result === 'unknown' ? 'UNKNOWN_STATUS' : 'INCONCLUSIVE_STATUS',
          message: result === 'unknown' ? 'Email verifier returned unknown status' : 'Email verification inconclusive',
          details: 'Email deliverability could not be confirmed'
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
        flags: [providerStatus],
        suggested_correction: null, // Reoon doesn't provide this in simple mode
        execution_time: executionTime,
        message: `Validation completed with status: ${providerStatus}`,
        timestamp: new Date().toISOString(),
        bounceRisk,
        reputationFlags: [],
        riskFactors: providerStatus !== 'safe' ? [providerStatus] : [],
        confidence: result === 'valid' ? 95 : (result === 'invalid' ? 95 : 50),
        confidenceLevel: result === 'valid' ? 'very_high' : (result === 'invalid' ? 'very_high' : 'medium'),
        reasoning: [`Reoon API status: ${providerStatus}`],
        aggressiveMode
      }
    };

  } catch (error: unknown) {
    // Never log the Axios error object or message: its request URL includes the
    // email and the Reoon API key in query parameters.
    const status = axios.isAxiosError(error) ? error.response?.status : undefined;
    const errorCode = axios.isAxiosError(error) ? error.code : undefined;
    const safeCode = errorCode && /^(ECONNABORTED|ETIMEDOUT|ECONNRESET|ENOTFOUND|EAI_AGAIN)$/.test(errorCode)
      ? errorCode : undefined;
    console.error('[VALIDATE_EMAIL] Request failed', { status, code: safeCode });
    
    // Handle Axios timeout or network errors
    if (errorCode === 'ECONNABORTED' || status === 504) {
      return {
        success: false,
        error: {
          code: 'API_TIMEOUT',
          message: 'Email verification API timed out',
          details: 'Reoon verification request timed out'
        }
      };
    }

    if (status === 403 && process.env.REOON_API_KEY && await noReoonCredits(process.env.REOON_API_KEY)) {
      return {
        success: false,
        error: {
          code: 'NO_CREDITS',
          message: 'Reoon has no available verification credits',
          details: 'Add verification credits before retrying'
        }
      };
    }

    return {
      success: false,
      error: {
        code: status ? `HTTP_${status}` : (safeCode || 'VALIDATION_ERROR'),
        message: status ? `Email verification request returned HTTP ${status}` : 'An unexpected error occurred during validation',
        details: 'Reoon verification request failed; no email was verified'
      }
    };
  }
}
