"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.testSMTPConnectivityActivity = testSMTPConnectivityActivity;
exports.validateEmail = validateEmail;
const email_validation_1 = require("../../lib/email-validation");
/**
 * Activity: Test initial SMTP connectivity over port 25
 * Returns a simple success/failure so it's visible in Temporal history
 */
async function testSMTPConnectivityActivity(input) {
    const { email, timeoutMs } = input;
    console.log(`[SMTP_CONNECTIVITY] Starting SMTP connectivity test for: ${email}`);
    try {
        if (!email || !(0, email_validation_1.isValidEmailFormat)(email)) {
            return {
                success: false,
                message: 'Invalid or missing email',
                errorCode: 'INVALID_EMAIL_FORMAT'
            };
        }
        const domain = (0, email_validation_1.extractDomain)(email);
        console.log(`[SMTP_CONNECTIVITY] Extracted domain: ${domain}`);
        const mxRecords = await (0, email_validation_1.getMXRecords)(domain);
        if (!mxRecords || mxRecords.length === 0) {
            console.log(`[SMTP_CONNECTIVITY] No MX records for domain: ${domain}`);
            return {
                success: false,
                message: 'No MX records for domain',
                errorCode: 'NO_MX_RECORDS'
            };
        }
        const connectTimeout = typeof timeoutMs === 'number'
            ? timeoutMs
            : (process.env.EMAIL_VALIDATOR_CONNECT_TIMEOUT_MS ? Number(process.env.EMAIL_VALIDATOR_CONNECT_TIMEOUT_MS) : 8000);
        // Try up to first 3 MX records, prefer IPv4 in socket util (already implemented there)
        let lastError = null;
        for (let i = 0; i < Math.min(mxRecords.length, 3); i++) {
            const mx = mxRecords[i];
            console.log(`[SMTP_CONNECTIVITY] Testing TCP connect to ${mx.exchange}:25 with timeout ${connectTimeout}ms`);
            const connectionTest = await (0, email_validation_1.createSocketWithTimeout)(mx.exchange, 25, connectTimeout);
            if (connectionTest.success) {
                // Cleanup socket
                connectionTest.socket?.destroy();
                console.log(`[SMTP_CONNECTIVITY] Connectivity OK via ${mx.exchange}:25`);
                return {
                    success: true,
                    host: mx.exchange,
                    message: 'SMTP connectivity OK'
                };
            }
            console.log(`[SMTP_CONNECTIVITY] Connection failed on ${mx.exchange}: ${connectionTest.error || 'Unknown error'}`);
            lastError = { error: connectionTest.error, errorCode: connectionTest.errorCode };
        }
        // If none succeeded
        return {
            success: false,
            message: 'Unable to establish SMTP connection on port 25',
            error: lastError?.error || 'Connection failed',
            errorCode: lastError?.errorCode || 'CONNECTION_ERROR'
        };
    }
    catch (error) {
        console.error(`[SMTP_CONNECTIVITY] Error during connectivity test:`, error?.message || error);
        return {
            success: false,
            message: 'SMTP connectivity check threw an error',
            error: error?.message || 'Unknown error',
            errorCode: error?.code || 'SMTP_CONNECTIVITY_ERROR'
        };
    }
}
/**
 * Validates an email address using SMTP validation with catchall detection
 */
async function validateEmail(input) {
    const startTime = Date.now();
    try {
        console.log(`[VALIDATE_EMAIL] 🚀 Starting email validation process`);
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
        console.log(`[VALIDATE_EMAIL] 📧 Validating email: ${email} (aggressive: ${aggressiveMode})`);
        // Basic format validation
        if (!(0, email_validation_1.isValidEmailFormat)(email)) {
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
        const domain = (0, email_validation_1.extractDomain)(email);
        console.log(`[VALIDATE_EMAIL] 🌐 Domain extracted: ${domain}`);
        // Check if domain exists before proceeding with other validations
        console.log(`[VALIDATE_EMAIL] 🔍 Checking domain existence: ${domain}`);
        const domainCheck = await (0, email_validation_1.checkDomainExists)(domain);
        if (!domainCheck.exists) {
            const executionTime = Date.now() - startTime;
            console.log(`[VALIDATE_EMAIL] ❌ Domain does not exist: ${domain}`);
            return {
                success: true,
                data: {
                    email,
                    isValid: false,
                    deliverable: false,
                    result: 'invalid',
                    flags: ['domain_not_found', 'no_dns_records'],
                    suggested_correction: null,
                    execution_time: executionTime,
                    message: domainCheck.errorMessage || 'Domain does not exist',
                    timestamp: new Date().toISOString(),
                    bounceRisk: 'high',
                    reputationFlags: ['non_existent_domain'],
                    riskFactors: ['domain_not_found'],
                    confidence: 95,
                    confidenceLevel: 'very_high',
                    reasoning: [
                        'Domain does not exist in DNS (-95)',
                        `Error: ${domainCheck.errorCode || 'DOMAIN_NOT_FOUND'}`
                    ],
                    aggressiveMode
                }
            };
        }
        console.log(`[VALIDATE_EMAIL] ✅ Domain exists: ${domain} (IPv4: ${domainCheck.hasARecord})`);
        // Check for disposable email domains
        if ((0, email_validation_1.isDisposableEmail)(domain)) {
            const executionTime = Date.now() - startTime;
            return {
                success: true,
                data: {
                    email,
                    isValid: false,
                    deliverable: false,
                    result: 'disposable',
                    flags: ['disposable_email'],
                    suggested_correction: null,
                    execution_time: executionTime,
                    message: 'Email is from a disposable email provider',
                    timestamp: new Date().toISOString(),
                    bounceRisk: 'high',
                    reputationFlags: ['disposable_provider'],
                    riskFactors: ['disposable_provider'],
                    confidence: 90,
                    confidenceLevel: 'very_high',
                    reasoning: ['Disposable email provider detected (-90)'],
                    aggressiveMode
                }
            };
        }
        // Get MX records for the domain
        console.log(`[VALIDATE_EMAIL] 🔍 Looking up MX records for domain: ${domain}`);
        let mxRecords;
        try {
            mxRecords = await (0, email_validation_1.getMXRecords)(domain);
            console.log(`[VALIDATE_EMAIL] 📋 Found ${mxRecords.length} MX records:`, mxRecords);
        }
        catch (error) {
            const executionTime = Date.now() - startTime;
            console.error(`[VALIDATE_EMAIL] ❌ Failed to get MX records:`, error);
            // Determine appropriate response based on error type
            let result = 'invalid';
            let flags = [];
            let message = 'Domain validation failed';
            let bounceRisk = 'high';
            let reputationFlags = [];
            let confidence = 25;
            let confidenceLevel = 'low';
            let reasoning = [];
            let isValid = false;
            let deliverable = false;
            // Check if domain is likely a non-email domain before expensive fallback validation
            let fallbackResult = null;
            if (error.code === 'NO_MX_RECORDS' || error.code === 'DNS_TIMEOUT' || error.code === 'DNS_SERVER_FAILURE') {
                // Quick check for obviously non-email domains
                const nonEmailCheck = (0, email_validation_1.isLikelyNonEmailDomain)(domain);
                if (nonEmailCheck.isNonEmail) {
                    console.log(`[VALIDATE_EMAIL] 🚫 Skipping fallback - likely non-email domain: ${nonEmailCheck.reason} (confidence: ${nonEmailCheck.confidence}%)`);
                    // Don't perform expensive fallback validation for obvious non-email domains
                }
                else {
                    console.log(`[VALIDATE_EMAIL] 🔄 Attempting fallback validation for ${domain} (error: ${error.code})`);
                    try {
                        fallbackResult = await (0, email_validation_1.attemptFallbackValidation)(domain);
                        console.log(`[VALIDATE_EMAIL] 📋 Fallback result:`, {
                            canReceiveEmail: fallbackResult.canReceiveEmail,
                            method: fallbackResult.fallbackMethod,
                            confidence: fallbackResult.confidence,
                            flags: fallbackResult.flags,
                            message: fallbackResult.message
                        });
                    }
                    catch (fallbackError) {
                        console.error(`[VALIDATE_EMAIL] ❌ Fallback validation failed:`, fallbackError.message || fallbackError);
                    }
                }
            }
            switch (error.code) {
                case 'DOMAIN_NOT_FOUND':
                    result = 'invalid';
                    flags = ['domain_not_found', 'no_mx_record'];
                    message = 'Domain does not exist';
                    bounceRisk = 'high';
                    reputationFlags = ['non_existent_domain'];
                    confidence = 95;
                    confidenceLevel = 'very_high';
                    reasoning = ['Domain does not exist (-95)', 'Error: DOMAIN_NOT_FOUND'];
                    break;
                case 'NO_MX_RECORDS':
                    const nonEmailCheck = (0, email_validation_1.isLikelyNonEmailDomain)(domain);
                    if (fallbackResult?.canReceiveEmail) {
                        // Fallback validation found evidence of email capability
                        result = 'risky';
                        isValid = true;
                        deliverable = false;
                        flags = ['no_mx_record', ...fallbackResult.flags];
                        message = `No MX records but ${fallbackResult.message}`;
                        bounceRisk = 'high';
                        reputationFlags = ['no_mx_but_mail_capable'];
                        confidence = Math.max(fallbackResult.confidence, 40); // Minimum confidence for positive fallback
                        confidenceLevel = confidence >= 70 ? 'high' : confidence >= 50 ? 'medium' : 'low';
                        reasoning = [
                            'No MX records found (-40)',
                            `Fallback validation: ${fallbackResult.fallbackMethod} (+${fallbackResult.confidence})`
                        ];
                    }
                    else if (nonEmailCheck.isNonEmail) {
                        // Domain pattern suggests it's not meant for email
                        result = 'invalid';
                        flags = ['no_mx_record', 'likely_non_email_domain'];
                        message = `Domain exists but appears to be a non-email domain: ${nonEmailCheck.reason}`;
                        bounceRisk = 'high';
                        reputationFlags = ['non_email_domain'];
                        confidence = Math.max(90, nonEmailCheck.confidence);
                        confidenceLevel = 'very_high';
                        reasoning = [
                            'No MX records found (-40)',
                            `Non-email domain pattern detected (+${nonEmailCheck.confidence})`
                        ];
                    }
                    else {
                        // No MX records and no fallback evidence - likely invalid for email
                        result = 'invalid';
                        flags = ['no_mx_record'];
                        message = 'Domain exists but has no mail servers configured and no fallback methods indicate email capability';
                        bounceRisk = 'high';
                        reputationFlags = ['no_mail_service'];
                        confidence = 85; // High confidence that it can't receive email
                        confidenceLevel = 'very_high';
                        reasoning = [
                            'No MX records found (-40)',
                            'No fallback validation methods succeeded (-45)',
                            'Domain exists but shows no email capability'
                        ];
                    }
                    break;
                case 'DNS_TIMEOUT':
                    if (fallbackResult?.canReceiveEmail) {
                        result = 'risky';
                        isValid = true;
                        deliverable = false;
                        flags = ['dns_timeout', ...fallbackResult.flags];
                        message = `DNS timeout but ${fallbackResult.message}`;
                        bounceRisk = 'medium';
                        reputationFlags = ['dns_issues_but_mail_capable'];
                        confidence = Math.max(fallbackResult.confidence - 20, 10);
                        confidenceLevel = confidence >= 50 ? 'medium' : 'low';
                        reasoning = [
                            'DNS timeout issues (-30)',
                            `Fallback validation: ${fallbackResult.fallbackMethod} (+${fallbackResult.confidence})`
                        ];
                    }
                    else {
                        result = 'unknown';
                        flags = ['dns_timeout'];
                        message = 'DNS lookup timeout - domain validation inconclusive';
                        bounceRisk = 'medium';
                        reputationFlags = ['dns_issues'];
                        confidence = 25;
                        reasoning = ['DNS timeout prevents validation (-75)'];
                    }
                    break;
                case 'DNS_SERVER_FAILURE':
                    if (fallbackResult?.canReceiveEmail) {
                        result = 'risky';
                        isValid = true;
                        deliverable = false;
                        flags = ['dns_server_failure', ...fallbackResult.flags];
                        message = `DNS server failure but ${fallbackResult.message}`;
                        bounceRisk = 'medium';
                        reputationFlags = ['dns_issues_but_mail_capable'];
                        confidence = Math.max(fallbackResult.confidence - 20, 10);
                        confidenceLevel = confidence >= 50 ? 'medium' : 'low';
                        reasoning = [
                            'DNS server failure (-30)',
                            `Fallback validation: ${fallbackResult.fallbackMethod} (+${fallbackResult.confidence})`
                        ];
                    }
                    else {
                        result = 'unknown';
                        flags = ['dns_server_failure'];
                        message = 'DNS server failure - domain validation inconclusive';
                        bounceRisk = 'medium';
                        reputationFlags = ['dns_issues'];
                        confidence = 25;
                        reasoning = ['DNS server failure prevents validation (-75)'];
                    }
                    break;
                default:
                    result = 'unknown';
                    flags = ['dns_error'];
                    message = 'DNS resolution failed - domain validation inconclusive';
                    bounceRisk = 'high';
                    reputationFlags = ['dns_error'];
                    confidence = 15;
                    reasoning = ['DNS resolution failed (-85)', `Error type: ${error.code || 'DNS_ERROR'}`];
            }
            return {
                success: true,
                data: {
                    email,
                    isValid,
                    deliverable,
                    result,
                    flags,
                    suggested_correction: null,
                    execution_time: executionTime,
                    message,
                    timestamp: new Date().toISOString(),
                    bounceRisk,
                    reputationFlags,
                    riskFactors: [error.code?.toLowerCase() || 'dns_error'],
                    confidence,
                    confidenceLevel,
                    reasoning,
                    aggressiveMode,
                    ...(fallbackResult && { fallbackValidation: fallbackResult })
                }
            };
        }
        if (mxRecords.length === 0) {
            const executionTime = Date.now() - startTime;
            return {
                success: true,
                data: {
                    email,
                    isValid: false,
                    deliverable: false,
                    result: 'invalid',
                    flags: ['no_mx_record'],
                    suggested_correction: null,
                    execution_time: executionTime,
                    message: 'Domain has no MX records',
                    timestamp: new Date().toISOString(),
                    bounceRisk: 'high',
                    reputationFlags: ['no_mx_record'],
                    riskFactors: ['no_mx_records'],
                    confidence: 85,
                    confidenceLevel: 'very_high',
                    reasoning: ['No MX records found (-85)'],
                    aggressiveMode
                }
            };
        }
        // SMTP connectivity is now handled as a dedicated activity in the workflow for visibility
        // Try SMTP validation with MX records (try multiple if first fails with timeout)
        console.log(`[VALIDATE_EMAIL] 🔌 Attempting SMTP validation with ${mxRecords.length} MX record(s)`);
        // Check if we're running in Vercel (serverless environment)
        const isVercel = process.env.VERCEL === '1' || process.env.VERCEL_ENV;
        const maxMXAttempts = isVercel ? 2 : 3; // Reduce attempts in Vercel for faster response
        let smtpResult = null;
        let lastError = null;
        for (let i = 0; i < Math.min(mxRecords.length, maxMXAttempts); i++) { // Try fewer MX records in Vercel
            const mxRecord = mxRecords[i];
            console.log(`[VALIDATE_EMAIL] 🔌 Trying MX record ${i + 1}/${mxRecords.length}: ${mxRecord.exchange} (priority: ${mxRecord.priority})`);
            try {
                smtpResult = await (0, email_validation_1.performSMTPValidation)(email, mxRecord, aggressiveMode);
                // If we get a definitive result (valid/invalid), use it
                if (smtpResult.result === 'valid' || smtpResult.result === 'invalid' || smtpResult.result === 'catchall') {
                    console.log(`[VALIDATE_EMAIL] ✅ Got definitive result from ${mxRecord.exchange}: ${smtpResult.result}`);
                    break;
                }
                // If we get 'unknown' but it's not a timeout, check if it's an IP block
                if (smtpResult.result === 'unknown' && !smtpResult.flags.includes('smtp_timeout')) {
                    // If this is an IP block, we should try fallback validation
                    if (smtpResult.flags.includes('ip_blocked') || smtpResult.flags.includes('validation_blocked')) {
                        console.log(`[VALIDATE_EMAIL] 🚫 IP blocked by ${mxRecord.exchange}, will attempt fallback validation`);
                        // Continue to try other MX records or fallback validation
                        if (i < Math.min(mxRecords.length, 3) - 1) {
                            lastError = smtpResult;
                            continue;
                        }
                    }
                    else {
                        console.log(`[VALIDATE_EMAIL] ⚠️ Got inconclusive result from ${mxRecord.exchange}: ${smtpResult.result}`);
                        break;
                    }
                }
                // If it's a timeout or risky result, try next MX record if available
                if (i < Math.min(mxRecords.length, maxMXAttempts) - 1) {
                    console.log(`[VALIDATE_EMAIL] ⏱️ Timeout/risky result from ${mxRecord.exchange}, trying next MX record...`);
                    lastError = smtpResult;
                    continue;
                }
            }
            catch (error) {
                console.log(`[VALIDATE_EMAIL] ❌ Error with MX record ${mxRecord.exchange}:`, error);
                lastError = error;
                // If this is the last MX record, we'll use the error
                if (i === Math.min(mxRecords.length, maxMXAttempts) - 1) {
                    // Create a fallback result for the error
                    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                    smtpResult = {
                        isValid: false,
                        deliverable: false,
                        result: 'unknown',
                        flags: ['smtp_error'],
                        message: `All MX servers failed: ${errorMessage}`,
                        confidence: 20,
                        confidenceLevel: 'low',
                        reasoning: [`SMTP validation failed for all ${i + 1} MX servers`]
                    };
                }
            }
        }
        // If we still don't have a result, use the last error
        if (!smtpResult) {
            smtpResult = {
                isValid: false,
                deliverable: false,
                result: 'unknown',
                flags: ['all_mx_failed'],
                message: 'All MX servers failed validation',
                confidence: 15,
                confidenceLevel: 'low',
                reasoning: ['All available MX servers failed to respond']
            };
        }
        // If we got IP blocks from all MX servers, or if we're in Vercel and got connection issues, try fallback validation
        const allBlocked = smtpResult.flags.includes('ip_blocked') ||
            smtpResult.flags.includes('validation_blocked') ||
            (lastError && typeof lastError === 'object' && 'flags' in lastError &&
                Array.isArray(lastError.flags) &&
                (lastError.flags.includes('ip_blocked') || lastError.flags.includes('validation_blocked')));
        const hasConnectionIssues = !!smtpResult && (smtpResult.flags.includes('connection_failed') ||
            smtpResult.flags.includes('smtp_timeout') ||
            smtpResult.flags.includes('all_mx_failed'));
        const shouldTryFallback = allBlocked || (isVercel && hasConnectionIssues && smtpResult && smtpResult.result === 'unknown');
        if (shouldTryFallback) {
            const fallbackReason = allBlocked ? 'IP blocked by servers' : 'Connection issues in serverless environment';
            console.log(`[VALIDATE_EMAIL] 🔄 ${fallbackReason}, attempting fallback validation for ${domain}`);
            try {
                // First try basic validation (similar to other providers)
                console.log(`[VALIDATE_EMAIL] 🔍 Performing basic email validation check`);
                const basicValidation = await (0, email_validation_1.performBasicEmailValidation)(domain);
                console.log(`[VALIDATE_EMAIL] Basic validation results:`, {
                    has_dns: basicValidation.has_dns,
                    has_dns_mx: basicValidation.has_dns_mx,
                    smtp_connectable: basicValidation.smtp_connectable,
                    details: basicValidation.details
                });
                // If basic validation shows email capability, use it
                if (basicValidation.has_dns && basicValidation.has_dns_mx) {
                    const policyBlocked = ['ip_blocked', 'validation_blocked', 'anti_spam_policy'].some((f) => ((smtpResult && smtpResult.flags) ? smtpResult.flags : []).includes(f));
                    const flags = ['basic_validation'];
                    if (basicValidation.has_dns)
                        flags.push('has_dns');
                    if (basicValidation.has_dns_mx)
                        flags.push('has_dns_mx');
                    if (basicValidation.smtp_connectable)
                        flags.push('smtp_connectable');
                    if (policyBlocked) {
                        // Conservative: policy-blocked sessions remain risky and non-deliverable
                        const confidence = basicValidation.smtp_connectable ? 55 : 45;
                        smtpResult = {
                            isValid: true,
                            deliverable: false,
                            result: 'risky',
                            flags: [...((smtpResult && smtpResult.flags) ? smtpResult.flags : []), ...flags, 'policy_blocked_fallback'],
                            message: `Policy-blocked SMTP. Basic validation indicates DNS=${basicValidation.has_dns}, MX=${basicValidation.has_dns_mx}, SMTP=${basicValidation.smtp_connectable}`,
                            confidence,
                            confidenceLevel: (confidence >= 70 ? 'high' : confidence >= 50 ? 'medium' : 'low'),
                            reasoning: [
                                'SMTP validation blocked by policy/IP reputation (-40)',
                                `DNS records found (+${basicValidation.has_dns ? 20 : 0})`,
                                `MX records found (+${basicValidation.has_dns_mx ? 30 : 0})`,
                                `SMTP connectable (+${basicValidation.smtp_connectable ? 10 : 0})`
                            ]
                        };
                        console.log(`[VALIDATE_EMAIL] ⚖️ Policy-blocked case treated as risky (non-deliverable)`);
                    }
                    else {
                        const confidence = basicValidation.smtp_connectable ? 70 : 50;
                        smtpResult = {
                            isValid: true,
                            deliverable: basicValidation.smtp_connectable, // Deliverable if SMTP is connectable
                            result: (basicValidation.smtp_connectable ? 'valid' : 'risky'),
                            flags: [...((smtpResult && smtpResult.flags) ? smtpResult.flags : []), ...flags],
                            message: `Basic validation: DNS=${basicValidation.has_dns}, MX=${basicValidation.has_dns_mx}, SMTP=${basicValidation.smtp_connectable}`,
                            confidence,
                            confidenceLevel: (confidence >= 70 ? 'high' : confidence >= 50 ? 'medium' : 'low'),
                            reasoning: [
                                `DNS records found (+${basicValidation.has_dns ? 20 : 0})`,
                                `MX records found (+${basicValidation.has_dns_mx ? 30 : 0})`,
                                `SMTP connectable (+${basicValidation.smtp_connectable ? 20 : 0})`
                            ]
                        };
                        console.log(`[VALIDATE_EMAIL] ✅ Basic validation successful with confidence ${confidence}%`);
                    }
                }
                else {
                    // Try advanced fallback validation
                    const fallbackResult = await (0, email_validation_1.attemptFallbackValidation)(domain);
                    if (fallbackResult.canReceiveEmail) {
                        // Fallback validation suggests the domain can receive email
                        console.log(`[VALIDATE_EMAIL] ✅ Advanced fallback validation successful: ${fallbackResult.message}`);
                        smtpResult = {
                            isValid: true,
                            deliverable: false, // Still risky due to validation limitations
                            result: 'risky',
                            flags: [...smtpResult.flags, 'fallback_validation', ...fallbackResult.flags],
                            message: `SMTP validation blocked but ${fallbackResult.message}`,
                            confidence: Math.max(fallbackResult.confidence - 20, 30), // Reduce confidence due to IP block
                            confidenceLevel: (fallbackResult.confidence >= 70 ? 'medium' : 'low'),
                            reasoning: [
                                'SMTP validation blocked by IP reputation (-40)',
                                `Fallback validation: ${fallbackResult.fallbackMethod} (+${fallbackResult.confidence})`
                            ]
                        };
                    }
                    else {
                        console.log(`[VALIDATE_EMAIL] ❌ All fallback validations failed`);
                        // Keep original result but add fallback info
                        smtpResult.flags.push('all_fallbacks_failed');
                        smtpResult.reasoning = [
                            ...(smtpResult.reasoning || []),
                            'Basic and advanced fallback validation failed (-10)'
                        ];
                    }
                }
            }
            catch (fallbackError) {
                console.error(`[VALIDATE_EMAIL] ❌ Fallback validation error:`, fallbackError.message || fallbackError);
                smtpResult.flags.push('fallback_error');
            }
        }
        const executionTime = Date.now() - startTime;
        console.log(`[VALIDATE_EMAIL] ✅ SMTP validation completed:`, {
            isValid: smtpResult.isValid,
            deliverable: smtpResult.deliverable,
            result: smtpResult.result,
            flags: smtpResult.flags,
            executionTime
        });
        // Heuristic: treat temporary failures as risky valid (not deliverable) when DNS+MX+SMTP connectivity
        // and bounce risk is not high. Enable with EMAIL_VALIDATOR_TEMPORARY_AS_RISKY=1
        try {
            const temporaryAsRisky = process.env.EMAIL_VALIDATOR_TEMPORARY_AS_RISKY === '1';
            if (temporaryAsRisky && smtpResult.result === 'unknown') {
                const tempFlags = new Set((smtpResult.flags || []).map((f) => f.toLowerCase()));
                const tempOnlyBlockers = tempFlags.has('temporary_failure') && !tempFlags.has('user_unknown') && !tempFlags.has('permanent_error');
                const hasConnectivity = tempFlags.has('smtp_connectable');
                if (tempOnlyBlockers && hasConnectivity && domainCheck?.exists && Array.isArray(mxRecords) && mxRecords.length > 0) {
                    const reputationForHeuristics = await (0, email_validation_1.checkDomainReputation)(domain);
                    const acceptableRisk = reputationForHeuristics.bounceRisk === 'low' || reputationForHeuristics.bounceRisk === 'medium';
                    if (acceptableRisk) {
                        smtpResult = {
                            ...smtpResult,
                            isValid: true,
                            deliverable: false,
                            result: 'risky',
                            flags: Array.from(new Set([...(smtpResult.flags || []), 'temporary_as_risky'])),
                            message: `${smtpResult.message} | Interpreting temporary failure as risky (DNS+MX+SMTP present)`,
                            confidence: Math.max(smtpResult.confidence ?? 0, 35),
                            confidenceLevel: ((Math.max(smtpResult.confidence ?? 0, 35) >= 85) ? 'very_high' : (Math.max(smtpResult.confidence ?? 0, 35) >= 70) ? 'high' : (Math.max(smtpResult.confidence ?? 0, 35) >= 50) ? 'medium' : 'low')
                        };
                        console.log(`[VALIDATE_EMAIL] ⚖️ Temporary-as-risky applied (isValid=true, deliverable=false)`);
                    }
                }
            }
        }
        catch (heurErr) {
            console.log(`[VALIDATE_EMAIL] Heuristic (temporary_as_risky) skipped due to error:`, heurErr?.message || heurErr);
        }
        // Optional policy: treat anti-spam policy blocks as risky valid (reduce false negatives)
        // Default ON unless explicitly disabled: EMAIL_VALIDATOR_TREAT_POLICY_AS_RISKY === '0'
        const treatPolicyAsRisky = (process.env.EMAIL_VALIDATOR_TREAT_POLICY_AS_RISKY ?? '1') === '1';
        if (treatPolicyAsRisky &&
            smtpResult.result === 'unknown' &&
            Array.isArray(smtpResult.flags) && smtpResult.flags.includes('anti_spam_policy') &&
            domainCheck?.exists && Array.isArray(mxRecords) && mxRecords.length > 0) {
            const updatedFlags = [...smtpResult.flags, 'policy_as_risky'];
            smtpResult = {
                ...smtpResult,
                isValid: true,
                deliverable: false,
                result: 'risky',
                flags: updatedFlags,
                // Provide clearer message and avoid zero confidence
                message: 'Rejected by anti-spam policy; treating as risky valid due to DNS+MX presence',
                confidence: Math.max(smtpResult.confidence ?? 0, 20),
                confidenceLevel: (Math.max(smtpResult.confidence ?? 0, 20) >= 70 ? 'high' : Math.max(smtpResult.confidence ?? 0, 20) >= 50 ? 'medium' : 'low')
            };
            console.log(`[VALIDATE_EMAIL] ⚖️ Policy-as-risky applied (isValid=true, deliverable=false)`);
        }
        // Optional heuristic: infer deliverable=true cautiously on connectivity + DNS/MX with only policy/temporary blocks
        // Enable with EMAIL_VALIDATOR_DELIVERABLE_ON_CONNECT=1 (default off)
        try {
            const deliverableOnConnect = process.env.EMAIL_VALIDATOR_DELIVERABLE_ON_CONNECT === '1';
            const connectWhitelist = (process.env.EMAIL_VALIDATOR_DELIVERABLE_ON_CONNECT_DOMAINS || '')
                .split(',')
                .map((d) => d.trim().toLowerCase())
                .filter(Boolean);
            const isWhitelistedForConnect = connectWhitelist.some((d) => domain.toLowerCase().endsWith(d));
            const flagsSet = new Set((smtpResult.flags || []).map((f) => f.toLowerCase()));
            const hasConnectivity2 = flagsSet.has('smtp_connectable');
            const hasPolicyBlock = flagsSet.has('anti_spam_policy');
            const hasTemporaryBlock = flagsSet.has('temporary_failure');
            const noHardNegatives = !flagsSet.has('user_unknown') && !flagsSet.has('permanent_error');
            if (deliverableOnConnect &&
                hasConnectivity2 &&
                (hasPolicyBlock || hasTemporaryBlock) &&
                noHardNegatives &&
                domainCheck?.exists && Array.isArray(mxRecords) && mxRecords.length > 0) {
                // Require acceptable bounce risk (low/medium)
                const reputationForDeliverable = await (0, email_validation_1.checkDomainReputation)(domain);
                if (reputationForDeliverable.bounceRisk !== 'high' || isWhitelistedForConnect) {
                    smtpResult = {
                        ...smtpResult,
                        deliverable: true,
                        result: smtpResult.result === 'unknown' ? 'risky' : smtpResult.result,
                        flags: [...smtpResult.flags, isWhitelistedForConnect ? 'deliverable_on_connect_whitelist' : 'deliverable_on_connect'],
                        message: `${smtpResult.message} | Inferring deliverable (DNS+MX+SMTP, only ${hasPolicyBlock ? 'policy' : 'temporary'} block${isWhitelistedForConnect ? ', domain whitelisted' : ''})`,
                        confidence: Math.max(smtpResult.confidence ?? 0, 45),
                        confidenceLevel: (Math.max(smtpResult.confidence ?? 0, 45) >= 85 ? 'very_high' : Math.max(smtpResult.confidence ?? 0, 45) >= 70 ? 'high' : Math.max(smtpResult.confidence ?? 0, 45) >= 50 ? 'medium' : 'low')
                    };
                    console.log(`[VALIDATE_EMAIL] 📬 Deliverable-on-connect heuristic applied cautiously (deliverable=true)`);
                }
            }
        }
        catch (heurErr) {
            console.log(`[VALIDATE_EMAIL] Heuristic (deliverable_on_connect) skipped due to error:`, heurErr?.message || heurErr);
        }
        // Extract reputation info from the result (already included in performSMTPValidation)
        const reputationCheck = await (0, email_validation_1.checkDomainReputation)(domain);
        // Infer deliverable from available signals to avoid false negatives
        const inferred = (0, email_validation_1.inferDeliverableFromSignals)({
            isValid: smtpResult.isValid,
            result: smtpResult.result,
            flags: smtpResult.flags,
            currentDeliverable: smtpResult.deliverable
        });
        // Consistency rule: if deliverable is true, isValid must be true.
        let finalIsValid = smtpResult.isValid;
        let finalResult = smtpResult.result;
        let finalFlags = [...smtpResult.flags, ...inferred.extraFlags, ...reputationCheck.reputationFlags];
        // Dedupe flags to avoid duplicates like 'anti_spam_policy'
        finalFlags = Array.from(new Set(finalFlags));
        if (inferred.deliverable && !finalIsValid) {
            finalIsValid = true;
            // If status was unknown, upgrade to risky to reflect uncertainty
            if (finalResult === 'unknown')
                finalResult = 'risky';
            finalFlags = [...finalFlags, 'is_valid_inferred'];
        }
        const response = {
            success: true,
            data: {
                email,
                isValid: finalIsValid,
                deliverable: inferred.deliverable,
                result: finalResult,
                flags: finalFlags,
                suggested_correction: null,
                execution_time: executionTime,
                message: smtpResult.message,
                timestamp: new Date().toISOString(),
                bounceRisk: reputationCheck.bounceRisk,
                reputationFlags: reputationCheck.reputationFlags,
                riskFactors: reputationCheck.riskFactors,
                confidence: smtpResult.confidence,
                confidenceLevel: smtpResult.confidenceLevel,
                reasoning: smtpResult.reasoning,
                aggressiveMode
            }
        };
        return response;
    }
    catch (error) {
        console.error(`[VALIDATE_EMAIL] ❌ Unexpected error:`, error);
        return {
            success: false,
            error: {
                code: 'INTERNAL_ERROR',
                message: 'Internal server error',
                details: process.env.NODE_ENV === 'development' ? error.message : 'An error occurred while validating the email'
            }
        };
    }
}
