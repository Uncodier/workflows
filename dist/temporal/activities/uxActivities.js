"use strict";
/**
 * UX Activities
 * Activities for calling external UX agent API endpoints
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.uxAnalysisActivity = uxAnalysisActivity;
exports.uxAssimilateActivity = uxAssimilateActivity;
exports.uxExperimentsActivity = uxExperimentsActivity;
const apiService_1 = require("../services/apiService");
const logger_1 = require("../../lib/logger");
/**
 * Activity to call UX Analysis API
 */
async function uxAnalysisActivity(request) {
    try {
        logger_1.logger.info('🔍 Starting UX analysis', {
            site_id: request.site_id,
            userId: request.userId
        });
        const requestBody = {
            site_id: request.site_id,
            userId: request.userId,
            ...request.additionalData
        };
        console.log('📤 Sending UX analysis request:', JSON.stringify(requestBody, null, 2));
        const response = await apiService_1.apiService.post('/api/agents/ux/analyze', requestBody);
        if (!response.success) {
            logger_1.logger.error('❌ UX analysis API call failed', {
                error: response.error,
                site_id: request.site_id
            });
            return {
                success: false,
                error: {
                    code: response.error?.code || 'API_ERROR',
                    message: response.error?.message || 'Failed to call UX analysis API'
                }
            };
        }
        logger_1.logger.info('✅ UX analysis completed successfully', {
            site_id: request.site_id
        });
        return {
            success: true,
            data: response.data
        };
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger_1.logger.error('❌ UX analysis activity exception', {
            error: errorMessage,
            site_id: request.site_id
        });
        return {
            success: false,
            error: {
                code: 'ACTIVITY_ERROR',
                message: `UX analysis activity failed: ${errorMessage}`
            }
        };
    }
}
/**
 * Activity to call UX Assimilate API
 */
async function uxAssimilateActivity(request) {
    try {
        logger_1.logger.info('🧠 Starting UX assimilation', {
            site_id: request.site_id,
            userId: request.userId
        });
        const requestBody = {
            site_id: request.site_id,
            userId: request.userId,
            ...request.additionalData
        };
        console.log('📤 Sending UX assimilate request:', JSON.stringify(requestBody, null, 2));
        const response = await apiService_1.apiService.post('/api/agents/ux/assimilate', requestBody);
        if (!response.success) {
            logger_1.logger.error('❌ UX assimilate API call failed', {
                error: response.error,
                site_id: request.site_id
            });
            return {
                success: false,
                error: {
                    code: response.error?.code || 'API_ERROR',
                    message: response.error?.message || 'Failed to call UX assimilate API'
                }
            };
        }
        logger_1.logger.info('✅ UX assimilation completed successfully', {
            site_id: request.site_id
        });
        return {
            success: true,
            data: response.data
        };
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger_1.logger.error('❌ UX assimilate activity exception', {
            error: errorMessage,
            site_id: request.site_id
        });
        return {
            success: false,
            error: {
                code: 'ACTIVITY_ERROR',
                message: `UX assimilate activity failed: ${errorMessage}`
            }
        };
    }
}
/**
 * Activity to call UX Experiments API
 */
async function uxExperimentsActivity(request) {
    try {
        logger_1.logger.info('🧪 Starting UX experiments', {
            site_id: request.site_id,
            userId: request.userId
        });
        const requestBody = {
            site_id: request.site_id,
            userId: request.userId,
            ...request.additionalData
        };
        console.log('📤 Sending UX experiments request:', JSON.stringify(requestBody, null, 2));
        const response = await apiService_1.apiService.post('/api/agents/ux/experiments', requestBody);
        if (!response.success) {
            logger_1.logger.error('❌ UX experiments API call failed', {
                error: response.error,
                site_id: request.site_id
            });
            return {
                success: false,
                error: {
                    code: response.error?.code || 'API_ERROR',
                    message: response.error?.message || 'Failed to call UX experiments API'
                }
            };
        }
        logger_1.logger.info('✅ UX experiments completed successfully', {
            site_id: request.site_id
        });
        return {
            success: true,
            data: response.data
        };
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger_1.logger.error('❌ UX experiments activity exception', {
            error: errorMessage,
            site_id: request.site_id
        });
        return {
            success: false,
            error: {
                code: 'ACTIVITY_ERROR',
                message: `UX experiments activity failed: ${errorMessage}`
            }
        };
    }
}
