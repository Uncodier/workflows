"use strict";
/**
 * Email Analysis Activities
 * Activities for calling external email analysis API
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.analyzeEmailsActivity = analyzeEmailsActivity;
exports.checkEmailAnalysisStatusActivity = checkEmailAnalysisStatusActivity;
const apiService_1 = require("../services/apiService");
/**
 * Activity to analyze emails using external API
 */
async function analyzeEmailsActivity(request) {
    console.log(`🔍 Analyzing emails for site ${request.site_id}`);
    console.log(`📋 Request:`, JSON.stringify(request, null, 2));
    try {
        console.log(`🕐 Starting email analysis API call at: ${new Date().toISOString()}`);
        console.log(`⏰ Using timeout: 600000ms (10 minutes)`);
        console.log(`📊 Request size: ${JSON.stringify(request).length} characters`);
        // Use extended timeout for email analysis operations (15 minutes to match activity timeout)
        const startTime = Date.now();
        const response = await apiService_1.apiService.request('/api/agents/email', {
            method: 'POST',
            body: request,
            timeout: 900000 // 15 minutes timeout (900,000ms) to match workflow activity timeout
        });
        const duration = Date.now() - startTime;
        console.log(`🕐 Email analysis API call completed at: ${new Date().toISOString()}`);
        console.log(`⏱️ API call duration: ${duration}ms`);
        console.log(`📊 Response size: ${JSON.stringify(response).length} characters`);
        if (!response.success) {
            console.error(`❌ Email analysis failed:`, response.error);
            throw new Error(`Email analysis failed: ${response.error?.message || 'Unknown API error'}`);
        }
        console.log(`✅ Email analysis completed successfully`);
        return {
            success: true,
            data: response.data
        };
    }
    catch (error) {
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
async function checkEmailAnalysisStatusActivity(commandId) {
    console.log(`🔍 Checking command status: ${commandId}`);
    try {
        const response = await apiService_1.apiService.get(`/api/commands/${commandId}`);
        if (!response.success) {
            console.error(`❌ Command status check failed:`, response.error);
            throw new Error(`Command status check failed: ${response.error?.message}`);
        }
        console.log(`✅ Command status retrieved successfully`);
        return response.data;
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`❌ Command status check failed: ${errorMessage}`);
        throw new Error(`Command status check failed: ${errorMessage}`);
    }
}
