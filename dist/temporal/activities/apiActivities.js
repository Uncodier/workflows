"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchDataActivity = fetchDataActivity;
exports.createApiResourceActivity = createApiResourceActivity;
exports.updateApiResourceActivity = updateApiResourceActivity;
exports.deleteApiResourceActivity = deleteApiResourceActivity;
exports.validateContactInformation = validateContactInformation;
exports.leadContactGenerationActivity = leadContactGenerationActivity;
exports.sendDailyStandUpNotificationActivity = sendDailyStandUpNotificationActivity;
exports.sendProjectAnalysisNotificationActivity = sendProjectAnalysisNotificationActivity;
const apiService_1 = require("../services/apiService");
/**
 * Activity to fetch data from the API
 */
async function fetchDataActivity(resourceId) {
    const response = await apiService_1.apiService.get(`/resources/${resourceId}`);
    if (!response.success) {
        throw new Error(`Failed to fetch resource ${resourceId}: ${response.error?.message}`);
    }
    return response.data;
}
/**
 * Activity to create a resource via the API
 */
async function createApiResourceActivity(data) {
    const response = await apiService_1.apiService.post('/resources', data);
    if (!response.success) {
        throw new Error(`Failed to create resource: ${response.error?.message}`);
    }
    return response.data;
}
/**
 * Activity to update a resource via the API
 */
async function updateApiResourceActivity(resourceId, data) {
    const response = await apiService_1.apiService.put(`/resources/${resourceId}`, data);
    if (!response.success) {
        throw new Error(`Failed to update resource ${resourceId}: ${response.error?.message}`);
    }
    return response.data;
}
/**
 * Activity to delete a resource via the API
 */
async function deleteApiResourceActivity(resourceId) {
    const response = await apiService_1.apiService.delete(`/resources/${resourceId}`);
    if (!response.success) {
        throw new Error(`Failed to delete resource ${resourceId}: ${response.error?.message}`);
    }
    return response.data;
}
/**
 * Activity to validate contact information (email, phone, etc.)
 * Accepts context and handles all contact validation decisions internally
 */
async function validateContactInformation(request) {
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
        const response = await apiService_1.apiService.post('/api/agents/tools/validateEmail', { email });
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
        // Handle the API response structure
        const data = response.data;
        console.log(`✅ Email validation response:`, data);
        console.log(`🔍 Full API response structure:`, JSON.stringify(response, null, 2));
        // The API response structure is: { success: true, data: { isValid: false, result: "invalid", ... } }
        // So we access data.isValid directly
        const isValid = data?.isValid || false;
        const result = data?.result || 'unknown';
        const flags = data?.flags || [];
        const suggested_correction = data?.suggested_correction;
        const execution_time = data?.execution_time;
        const message = data?.message;
        console.log(`🔍 Parsed validation data: isValid=${isValid}, result=${result}, flags=${JSON.stringify(flags)}`);
        const hasWhatsApp = phone && phone.trim() !== '';
        console.log(`📊 Validation result: isValid=${isValid}, hasWhatsApp=${hasWhatsApp}`);
        console.log(`📊 Validation details: result=${result}, flags=${JSON.stringify(flags)}`);
        const returnResult = {
            success: true,
            isValid,
            result,
            flags,
            suggested_correction,
            execution_time,
            message,
            shouldProceed: isValid, // Only proceed if valid
            validationType: 'email',
            reason: isValid ? 'Email is valid' : `Email is invalid (${result})`
        };
        console.log(`📤 Returning validation result:`, JSON.stringify(returnResult, null, 2));
        return returnResult;
    }
    catch (error) {
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
async function leadContactGenerationActivity(request) {
    const { name, domain, context, site_id, leadId } = request;
    console.log(`🔍 Lead Contact Generation Activity Started`);
    console.log(`📋 Context: lead=${leadId}, name=${name}, domain=${domain}, site=${site_id}`);
    console.log(`📝 Context details: ${context}`);
    try {
        const response = await apiService_1.apiService.post('/api/agents/dataAnalyst/leadContactGeneration', {
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
            emailAnalysis.recommendations.forEach((rec, index) => {
                console.log(`   ${index + 1}. ${rec}`);
            });
        }
        return {
            success: true,
            email_generation_analysis: emailList,
            emailAnalysisData: emailAnalysis,
            data: data
        };
    }
    catch (error) {
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
async function sendDailyStandUpNotificationActivity(params) {
    const { site_id, subject, message, systemAnalysis } = params;
    const response = await apiService_1.apiService.post('/api/notifications/dailyStandUp', {
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
async function sendProjectAnalysisNotificationActivity(params) {
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
        const response = await apiService_1.apiService.post('/api/notifications/projectAnalysis', requestBody);
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
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error('❌ Project analysis notification exception:', errorMessage);
        return {
            success: false,
            error: errorMessage
        };
    }
}
