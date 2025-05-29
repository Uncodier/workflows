"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchDataActivity = fetchDataActivity;
exports.createApiResourceActivity = createApiResourceActivity;
exports.updateApiResourceActivity = updateApiResourceActivity;
exports.deleteApiResourceActivity = deleteApiResourceActivity;
const config_1 = require("../../config/config");
/**
 * Generic function to make API calls
 * @param endpoint API endpoint path
 * @param method HTTP method
 * @param data Request data
 * @returns API response
 */
async function callApi(endpoint, method = 'GET', data) {
    const url = `${config_1.apiConfig.baseUrl}${endpoint}`;
    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config_1.apiConfig.apiKey}`,
    };
    const options = {
        method,
        headers,
        body: data ? JSON.stringify(data) : undefined,
    };
    try {
        const response = await fetch(url, options);
        if (!response.ok) {
            throw new Error(`API call failed: ${response.status} ${response.statusText}`);
        }
        return await response.json();
    }
    catch (error) {
        console.error('API call error:', error);
        throw error;
    }
}
/**
 * Activity to fetch data from the API
 */
async function fetchDataActivity(resourceId) {
    return callApi(`/resources/${resourceId}`);
}
/**
 * Activity to create a resource via the API
 */
async function createApiResourceActivity(data) {
    return callApi('/resources', 'POST', data);
}
/**
 * Activity to update a resource via the API
 */
async function updateApiResourceActivity(resourceId, data) {
    return callApi(`/resources/${resourceId}`, 'PUT', data);
}
/**
 * Activity to delete a resource via the API
 */
async function deleteApiResourceActivity(resourceId) {
    return callApi(`/resources/${resourceId}`, 'DELETE');
}
