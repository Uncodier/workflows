"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deepResearchActivity = deepResearchActivity;
exports.searchOperationActivity = searchOperationActivity;
exports.dataAnalysisActivity = dataAnalysisActivity;
const apiService_1 = require("../services/apiService");
/**
 * Activity to start deep research and get operations list
 */
async function deepResearchActivity(request) {
    console.log(`🔬 Starting deep research for topic: ${request.research_topic}, site: ${request.site_id}`);
    console.log(`📋 Request:`, JSON.stringify(request, null, 2));
    try {
        const response = await apiService_1.apiService.post('/api/agents/dataAnalyst/deepResearch', request);
        if (!response.success) {
            console.error(`❌ Deep research failed:`, response.error);
            return {
                success: false,
                error: response.error?.message || 'Failed to start deep research'
            };
        }
        const operations = response.data?.operations || response.data?.results || [];
        console.log(`✅ Deep research started successfully`);
        console.log(`📊 Generated ${operations.length} operations`);
        if (operations.length > 0) {
            console.log(`🔍 Operations:`);
            operations.forEach((op, index) => {
                console.log(`   ${index + 1}. ${op.type || op.description || `Operation ${index + 1}`}`);
            });
        }
        return {
            success: true,
            operations,
            data: response.data
        };
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`❌ Deep research failed: ${errorMessage}`);
        return {
            success: false,
            error: `Deep research activity failed: ${errorMessage}`
        };
    }
}
/**
 * Activity to execute search operation
 */
async function searchOperationActivity(request) {
    console.log(`🔍 Executing search operation: ${request.operation.type || request.operation.id}`);
    console.log(`📋 Operation:`, JSON.stringify(request.operation, null, 2));
    try {
        const requestBody = {
            operation: request.operation,
            ...(request.site_id && { site_id: request.site_id }),
            ...(request.userId && { userId: request.userId })
        };
        const response = await apiService_1.apiService.post('/api/agents/dataAnalyst/search', requestBody);
        if (!response.success) {
            console.error(`❌ Search operation failed:`, response.error);
            return {
                success: false,
                error: response.error?.message || 'Failed to execute search operation'
            };
        }
        const results = response.data?.results || response.data?.data || [];
        console.log(`✅ Search operation completed successfully`);
        console.log(`📊 Found ${Array.isArray(results) ? results.length : 'N/A'} results`);
        return {
            success: true,
            data: response.data,
            results
        };
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`❌ Search operation failed: ${errorMessage}`);
        return {
            success: false,
            error: `Search operation activity failed: ${errorMessage}`
        };
    }
}
/**
 * Activity to perform final analysis on all operation results
 */
async function dataAnalysisActivity(request) {
    console.log(`📊 Performing data analysis for topic: ${request.research_topic}, site: ${request.site_id}`);
    console.log(`📋 Analysis request with ${request.operations_results.length} operation results`);
    try {
        const response = await apiService_1.apiService.post('/api/agents/dataAnalyst/analysis', request);
        if (!response.success) {
            console.error(`❌ Data analysis failed:`, response.error);
            return {
                success: false,
                error: response.error?.message || 'Failed to perform data analysis'
            };
        }
        const analysis = response.data?.analysis || response.data;
        const insights = response.data?.insights || response.data?.findings || [];
        const recommendations = response.data?.recommendations || response.data?.next_steps || [];
        console.log(`✅ Data analysis completed successfully`);
        if (insights.length > 0) {
            console.log(`🔍 Generated ${insights.length} insights`);
        }
        if (recommendations.length > 0) {
            console.log(`💡 Generated ${recommendations.length} recommendations`);
        }
        return {
            success: true,
            analysis,
            insights,
            recommendations,
            data: response.data
        };
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`❌ Data analysis failed: ${errorMessage}`);
        return {
            success: false,
            error: `Data analysis activity failed: ${errorMessage}`
        };
    }
}
