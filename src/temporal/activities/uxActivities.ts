/**
 * UX Activities
 * Activities for calling external UX agent API endpoints
 */

import { apiService } from '../services/apiService';
import { logger } from '../../lib/logger';

export interface UxAnalysisRequest {
  site_id: string;
  userId?: string;
  additionalData?: any;
}

export interface UxAnalysisResponse {
  success: boolean;
  data?: any;
  error?: {
    code: string;
    message: string;
  };
}

export interface UxAssimilateRequest {
  site_id: string;
  userId?: string;
  additionalData?: any;
}

export interface UxAssimilateResponse {
  success: boolean;
  data?: any;
  error?: {
    code: string;
    message: string;
  };
}

export interface UxExperimentsRequest {
  site_id: string;
  userId?: string;
  additionalData?: any;
}

export interface UxExperimentsResponse {
  success: boolean;
  data?: any;
  error?: {
    code: string;
    message: string;
  };
}

/**
 * Activity to call UX Analysis API
 */
export async function uxAnalysisActivity(
  request: UxAnalysisRequest
): Promise<UxAnalysisResponse> {
  try {
    logger.info('🔍 Starting UX analysis', {
      site_id: request.site_id,
      userId: request.userId
    });

    const requestBody = {
      site_id: request.site_id,
      userId: request.userId,
      ...request.additionalData
    };

    console.log('📤 Sending UX analysis request:', JSON.stringify(requestBody, null, 2));

    const response = await apiService.post('/api/agents/ux/analyze', requestBody);

    if (!response.success) {
      logger.error('❌ UX analysis API call failed', {
        error: response.error,
        site_id: request.site_id
      });
      
      throw new Error(`Failed to call UX analysis API: ${response.error?.message || 'Unknown error'}`);
    }

    logger.info('✅ UX analysis completed successfully', {
      site_id: request.site_id
    });

    return {
      success: true,
      data: response.data
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('❌ UX analysis activity exception', {
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
export async function uxAssimilateActivity(
  request: UxAssimilateRequest
): Promise<UxAssimilateResponse> {
  try {
    logger.info('🧠 Starting UX assimilation', {
      site_id: request.site_id,
      userId: request.userId
    });

    const requestBody = {
      site_id: request.site_id,
      userId: request.userId,
      ...request.additionalData
    };

    console.log('📤 Sending UX assimilate request:', JSON.stringify(requestBody, null, 2));

    const response = await apiService.post('/api/agents/ux/assimilate', requestBody);

    if (!response.success) {
      logger.error('❌ UX assimilate API call failed', {
        error: response.error,
        site_id: request.site_id
      });
      
      throw new Error(`Failed to call UX assimilate API: ${response.error?.message || 'Unknown error'}`);
    }

    logger.info('✅ UX assimilation completed successfully', {
      site_id: request.site_id
    });

    return {
      success: true,
      data: response.data
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('❌ UX assimilate activity exception', {
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
export async function uxExperimentsActivity(
  request: UxExperimentsRequest
): Promise<UxExperimentsResponse> {
  try {
    logger.info('🧪 Starting UX experiments', {
      site_id: request.site_id,
      userId: request.userId
    });

    const requestBody = {
      site_id: request.site_id,
      userId: request.userId,
      ...request.additionalData
    };

    console.log('📤 Sending UX experiments request:', JSON.stringify(requestBody, null, 2));

    const response = await apiService.post('/api/agents/ux/experiments', requestBody);

    if (!response.success) {
      logger.error('❌ UX experiments API call failed', {
        error: response.error,
        site_id: request.site_id
      });
      
      throw new Error(`Failed to call UX experiments API: ${response.error?.message || 'Unknown error'}`);
    }

    logger.info('✅ UX experiments completed successfully', {
      site_id: request.site_id
    });

    return {
      success: true,
      data: response.data
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('❌ UX experiments activity exception', {
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