"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchDataActivity = fetchDataActivity;
exports.createApiResourceActivity = createApiResourceActivity;
exports.updateApiResourceActivity = updateApiResourceActivity;
exports.deleteApiResourceActivity = deleteApiResourceActivity;
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
