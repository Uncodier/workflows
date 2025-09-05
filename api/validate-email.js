import { executeWorkflow } from './execute-workflow.js';

/**
 * POST /api/validate-email
 * 
 * Validates an email address using SMTP validation with catchall detection
 * Runs on Render to bypass Vercel port 25 restrictions
 * 
 * Body:
 * {
 *   "email": "email@example.com",
 *   "aggressiveMode": false  // Optional: Enable aggressive validation
 * }
 * 
 * Response format with enhanced validation:
 * {
 *   "success": true,
 *   "data": {
 *     "email": "email@example.com",
 *     "isValid": true,        // Technical validity (SMTP accepts)
 *     "deliverable": false,   // Practical deliverability (considering bounce risk)
 *     "result": "risky",      // valid, invalid, disposable, catchall, risky, unknown
 *     "flags": ["high_bounce_risk"],
 *     "suggested_correction": null,
 *     "execution_time": 123,
 *     "message": "Email technically valid but high bounce risk",
 *     "timestamp": "2024-01-01T00:00:00.000Z",
 *     "bounceRisk": "high",
 *     "reputationFlags": ["strict_spam_policy"],
 *     "riskFactors": ["high_bounce_provider"],
 *     "confidence": 25,
 *     "confidenceLevel": "low",
 *     "reasoning": ["SMTP server accepts email (+30)", "High bounce risk domain (-35)"],
 *     "aggressiveMode": true
 *   }
 * }
 */
export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method === 'GET') {
    // Information about the email validation endpoint
    return res.status(200).json({
      success: true,
      data: {
        service: 'Advanced SMTP Email Validation',
        version: '2.0.0',
        description: 'Validate email addresses using SMTP protocol with catchall detection and bounce prediction',
        environment: 'Render (Port 25 enabled)',
        endpoints: {
          validate: {
            method: 'POST',
            path: '/api/validate-email',
            description: 'Validate a single email address using advanced SMTP validation',
            body: {
              email: 'string (required) - Email address to validate',
              aggressiveMode: 'boolean (optional) - Enable aggressive validation that marks high-confidence bounces as invalid'
            },
            response: {
              success: 'boolean - Operation success status',
              data: {
                email: 'string - The validated email',
                isValid: 'boolean - Technical validity (SMTP accepts)',
                deliverable: 'boolean - Practical deliverability (considering bounce risk)',
                result: 'string - Validation result (valid, invalid, disposable, catchall, risky, unknown)',
                flags: 'array - Additional validation flags',
                suggested_correction: 'string|null - Suggested correction if available',
                execution_time: 'number - Time taken to validate in milliseconds',
                message: 'string - Human readable message',
                timestamp: 'string - ISO timestamp of validation',
                bounceRisk: 'string - Predicted bounce risk (low, medium, high)',
                reputationFlags: 'array - Domain reputation indicators',
                riskFactors: 'array - Factors that increase bounce risk',
                confidence: 'number - Confidence score (0-100)',
                confidenceLevel: 'string - Confidence level (low, medium, high, very_high)',
                reasoning: 'array - Detailed reasoning for confidence score',
                aggressiveMode: 'boolean - Whether aggressive mode was enabled'
              }
            }
          }
        },
        features: [
          'MX record lookup',
          'SMTP connection testing (Port 25 access)',
          'TLS/STARTTLS support',
          'Disposable email detection',
          'Advanced catchall domain detection',
          'Bounce risk prediction',
          'Domain reputation analysis',
          'Anti-spam policy detection',
          'Confidence scoring system',
          'Aggressive validation mode',
          'Fallback validation methods'
        ],
        advantages: [
          'Full port 25 access (no Vercel restrictions)',
          'More accurate SMTP validation',
          'Better catchall detection',
          'Reduced false positives from IP blocks'
        ],
        timestamp: new Date().toISOString()
      }
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      error: {
        code: 'METHOD_NOT_ALLOWED',
        message: 'Method not allowed',
        details: 'Only POST and GET methods are supported'
      }
    });
  }

  try {
    console.log(`[VALIDATE_EMAIL_API] 🚀 Starting email validation request`);
    
    // Parse request body
    const { email, aggressiveMode = false } = req.body;
    
    // Validate that email is provided
    if (!email) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'EMAIL_REQUIRED',
          message: 'Email is required',
          details: 'Please provide an email address to validate'
        }
      });
    }
    
    console.log(`[VALIDATE_EMAIL_API] 📧 Validating email: ${email} (aggressive: ${aggressiveMode})`);
    
    // Execute the email validation workflow
    const result = await executeWorkflow({
      workflowType: 'validateEmailWorkflow',
      workflowId: `validate-email-${email}-${Date.now()}`,
      input: {
        email,
        aggressiveMode
      },
      taskQueue: 'validation'
    });
    
    console.log(`[VALIDATE_EMAIL_API] ✅ Workflow completed:`, {
      success: result.success,
      isValid: result.data?.isValid,
      deliverable: result.data?.deliverable,
      result: result.data?.result,
      executionTime: result.data?.execution_time
    });
    
    return res.status(200).json(result);
    
  } catch (error) {
    console.error(`[VALIDATE_EMAIL_API] ❌ Unexpected error:`, error);
    
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? error.message : 'An error occurred while validating the email'
      }
    });
  }
}
