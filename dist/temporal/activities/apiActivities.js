"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchDataActivity = fetchDataActivity;
exports.createApiResourceActivity = createApiResourceActivity;
exports.updateApiResourceActivity = updateApiResourceActivity;
exports.deleteApiResourceActivity = deleteApiResourceActivity;
exports.sendDailyStandUpNotificationActivity = sendDailyStandUpNotificationActivity;
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
