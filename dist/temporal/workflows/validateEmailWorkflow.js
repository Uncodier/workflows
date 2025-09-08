"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateEmailWorkflow = validateEmailWorkflow;
const workflow_1 = require("@temporalio/workflow");
const { testSMTPConnectivityActivity, validateEmail } = (0, workflow_1.proxyActivities)({
    startToCloseTimeout: '10 minutes',
    retry: {
        initialInterval: '1 second',
        maximumInterval: '30 seconds',
        backoffCoefficient: 2,
        maximumAttempts: 3
    }
});
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
async function validateEmailWorkflow(input) {
    console.log(`[VALIDATE_EMAIL_WORKFLOW] Starting email validation for: ${input.email} (aggressive: ${input.aggressiveMode || false})`);
    try {
        // First, ensure SMTP connectivity over port 25 is available and visible in history
        const connectivity = await testSMTPConnectivityActivity({
            email: input.email
        });
        if (!connectivity.success) {
            console.warn(`[VALIDATE_EMAIL_WORKFLOW] SMTP connectivity precheck failed for ${input.email}, continuing with validation:`, connectivity);
            // Do not abort; proceed to full validation which tries multiple MX and IPv4 first
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
    }
    catch (error) {
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
