"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cmoSystemAnalysisActivity = cmoSystemAnalysisActivity;
exports.cmoSalesAnalysisActivity = cmoSalesAnalysisActivity;
exports.cmoSupportAnalysisActivity = cmoSupportAnalysisActivity;
exports.cmoGrowthAnalysisActivity = cmoGrowthAnalysisActivity;
exports.cmoWrapUpActivity = cmoWrapUpActivity;
const apiService_1 = require("../services/apiService");
/**
 * Activity to analyze system status, settings, and billing via external CMO agent
 */
async function cmoSystemAnalysisActivity(request) {
    console.log(`🔧 Running CMO system analysis for site: ${request.site_id}`);
    console.log(`📋 Request:`, JSON.stringify(request, null, 2));
    try {
        // Use extended timeout for CMO analysis operations (5 minutes)
        const response = await apiService_1.apiService.request('/api/agents/cmo/dailyStandUp/system', {
            method: 'POST',
            body: request,
            timeout: 300000 // 5 minutes timeout (300,000ms) for CMO analysis
        });
        if (!response.success) {
            console.error(`❌ CMO system analysis failed:`, response.error);
            return {
                success: false,
                error: response.error?.message || 'Failed to run system analysis'
            };
        }
        console.log(`✅ CMO system analysis completed successfully`);
        console.log(`📊 Command ID: ${response.data?.command_id}`);
        return {
            success: true,
            ...response.data
        };
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`❌ CMO system analysis exception: ${errorMessage}`);
        return {
            success: false,
            error: errorMessage
        };
    }
}
/**
 * Activity to get sales summary from external sales agent via CMO coordination
 */
async function cmoSalesAnalysisActivity(request) {
    console.log(`💰 Running CMO sales analysis for site: ${request.site_id}`);
    console.log(`📋 Request:`, JSON.stringify(request, null, 2));
    try {
        // Use extended timeout for CMO analysis operations (5 minutes)
        const response = await apiService_1.apiService.request('/api/agents/cmo/dailyStandUp/sales', {
            method: 'POST',
            body: request,
            timeout: 300000 // 5 minutes timeout (300,000ms) for CMO analysis
        });
        if (!response.success) {
            console.error(`❌ CMO sales analysis failed:`, response.error);
            return {
                success: false,
                error: response.error?.message || 'Failed to run sales analysis'
            };
        }
        console.log(`✅ CMO sales analysis completed successfully`);
        console.log(`📊 Command ID: ${response.data?.command_id}`);
        return {
            success: true,
            ...response.data
        };
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`❌ CMO sales analysis exception: ${errorMessage}`);
        return {
            success: false,
            error: errorMessage
        };
    }
}
/**
 * Activity to analyze support tasks and conversations via external support agent coordination
 */
async function cmoSupportAnalysisActivity(request) {
    console.log(`🎧 Running CMO support analysis for site: ${request.site_id}`);
    console.log(`📋 Request:`, JSON.stringify(request, null, 2));
    try {
        // Use extended timeout for CMO analysis operations (5 minutes)
        const response = await apiService_1.apiService.request('/api/agents/cmo/dailyStandUp/support', {
            method: 'POST',
            body: request,
            timeout: 300000 // 5 minutes timeout (300,000ms) for CMO analysis
        });
        if (!response.success) {
            console.error(`❌ CMO support analysis failed:`, response.error);
            return {
                success: false,
                error: response.error?.message || 'Failed to run support analysis'
            };
        }
        console.log(`✅ CMO support analysis completed successfully`);
        console.log(`📊 Command ID: ${response.data?.command_id}`);
        return {
            success: true,
            ...response.data
        };
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`❌ CMO support analysis exception: ${errorMessage}`);
        return {
            success: false,
            error: errorMessage
        };
    }
}
/**
 * Activity to analyze growth content and experiments via external growth agent coordination
 */
async function cmoGrowthAnalysisActivity(request) {
    console.log(`📈 Running CMO growth analysis for site: ${request.site_id}`);
    console.log(`📋 Request:`, JSON.stringify(request, null, 2));
    try {
        // Use extended timeout for CMO analysis operations (5 minutes)
        const response = await apiService_1.apiService.request('/api/agents/cmo/dailyStandUp/growth', {
            method: 'POST',
            body: request,
            timeout: 300000 // 5 minutes timeout (300,000ms) for CMO analysis
        });
        if (!response.success) {
            console.error(`❌ CMO growth analysis failed:`, response.error);
            return {
                success: false,
                error: response.error?.message || 'Failed to run growth analysis'
            };
        }
        console.log(`✅ CMO growth analysis completed successfully`);
        console.log(`📊 Command ID: ${response.data?.command_id}`);
        return {
            success: true,
            ...response.data
        };
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`❌ CMO growth analysis exception: ${errorMessage}`);
        return {
            success: false,
            error: errorMessage
        };
    }
}
/**
 * Activity to wrap up all memories and create final summary via external CMO agent
 */
async function cmoWrapUpActivity(request) {
    console.log(`📋 Running CMO wrap up for site: ${request.site_id}`);
    console.log(`📊 Command ID: ${request.command_id}`);
    console.log(`📋 Request:`, JSON.stringify(request, null, 2));
    try {
        // Use extended timeout for CMO wrap up operations (5 minutes)
        const response = await apiService_1.apiService.request('/api/agents/cmo/dailyStandUp/wrapUp', {
            method: 'POST',
            body: request,
            timeout: 300000 // 5 minutes timeout (300,000ms) for CMO wrap up
        });
        if (!response.success) {
            console.error(`❌ CMO wrap up failed:`, response.error);
            return {
                success: false,
                error: response.error?.message || 'Failed to run wrap up'
            };
        }
        console.log(`✅ CMO wrap up completed successfully`);
        console.log(`📊 Final summary available`);
        return {
            success: true,
            ...response.data
        };
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`❌ CMO wrap up exception: ${errorMessage}`);
        return {
            success: false,
            error: errorMessage
        };
    }
}
