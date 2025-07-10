"use strict";
// Temporary implementation without Supabase
// TODO: Implement actual Supabase integration when credentials are available
Object.defineProperty(exports, "__esModule", { value: true });
exports.logWorkflowExecutionActivity = logWorkflowExecutionActivity;
exports.trackApiCallActivity = trackApiCallActivity;
exports.fetchConfigurationActivity = fetchConfigurationActivity;
exports.storeWorkflowResultActivity = storeWorkflowResultActivity;
exports.createResourceActivity = createResourceActivity;
exports.updateResourceActivity = updateResourceActivity;
exports.deleteResourceActivity = deleteResourceActivity;
exports.checkSiteAnalysisActivity = checkSiteAnalysisActivity;
const supabaseService_1 = require("../services/supabaseService");
/**
 * Activity to log workflow execution (temporary console implementation)
 */
async function logWorkflowExecutionActivity(data) {
    console.log('Workflow Execution Log:', JSON.stringify(data, null, 2));
    return { id: Date.now(), ...data };
}
/**
 * Activity to track API call metrics (temporary console implementation)
 */
async function trackApiCallActivity(data) {
    console.log('API Call Metrics:', JSON.stringify(data, null, 2));
    return { id: Date.now(), ...data };
}
/**
 * Activity to fetch configuration (temporary implementation)
 */
async function fetchConfigurationActivity(configName) {
    const mockConfig = {
        name: configName,
        value: {
            enabled: true,
            retryAttempts: 3,
            timeout: '1m',
        }
    };
    console.log('Fetching Configuration:', mockConfig);
    return mockConfig.value;
}
/**
 * Activity to store workflow results (temporary console implementation)
 */
async function storeWorkflowResultActivity(data) {
    console.log('Storing Workflow Result:', JSON.stringify(data, null, 2));
    return { id: Date.now(), ...data };
}
/**
 * Activity to create a resource (temporary implementation)
 */
async function createResourceActivity(data) {
    console.log('Creating Resource:', JSON.stringify(data, null, 2));
    return { id: Date.now(), ...data };
}
/**
 * Activity to update a resource (temporary implementation)
 */
async function updateResourceActivity(id, data) {
    console.log('Updating Resource:', id, JSON.stringify(data, null, 2));
    return { id, ...data, updatedAt: new Date().toISOString() };
}
/**
 * Activity to delete a resource (temporary implementation)
 */
async function deleteResourceActivity(id) {
    console.log('Deleting Resource:', id);
}
/**
 * Check if a site has analysis records
 */
async function checkSiteAnalysisActivity(siteId) {
    console.log(`🔍 Checking if site ${siteId} has analysis records...`);
    try {
        const supabaseService = (0, supabaseService_1.getSupabaseService)();
        const isConnected = await supabaseService.getConnectionStatus();
        if (!isConnected) {
            console.log('⚠️ Database not available, assuming no analysis');
            return {
                hasAnalysis: false,
                count: 0,
                reason: 'Database not available - assuming needs analysis'
            };
        }
        const analysisStatus = await supabaseService.hasSiteAnalysis(siteId);
        const reason = analysisStatus.hasAnalysis
            ? `Site has ${analysisStatus.count} completed analysis record(s), last one from ${analysisStatus.lastAnalysis?.created_at || 'unknown date'}`
            : 'No completed analysis found - needs initial site analysis';
        console.log(`📊 Site ${siteId} analysis check: ${analysisStatus.hasAnalysis ? 'HAS ANALYSIS' : 'NEEDS ANALYSIS'}`);
        console.log(`   Reason: ${reason}`);
        return {
            ...analysisStatus,
            reason
        };
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`❌ Error checking site analysis for ${siteId}:`, errorMessage);
        // In case of error, assume no analysis to be safe and allow scheduling
        return {
            hasAnalysis: false,
            count: 0,
            reason: `Error checking analysis (${errorMessage}) - assuming needs analysis for safety`
        };
    }
}
