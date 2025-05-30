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
        const response = await apiService_1.apiService.post('/api/agents/email', request);
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
