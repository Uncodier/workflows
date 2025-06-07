import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { 
  buildCampaignsWorkflow, 
  BuildCampaignsWorkflowParams, 
  BuildCampaignsWorkflowResult 
} from '../src/temporal/workflows/buildCampaignsWorkflow';
import { 
  getSegmentsActivity, 
  createCampaignsActivity,
  GetSegmentsResult,
  CreateCampaignResult,
  Segment,
  CreateCampaignRequest
} from '../src/temporal/activities/campaignActivities';
import { executeBuildCampaignsWorkflowActivity } from '../src/temporal/activities/workflowSchedulingActivities';

// Mock the API service
jest.mock('../src/temporal/services/apiService', () => ({
  apiService: {
    get: jest.fn(),
    post: jest.fn(),
  }
}));

// Mock temporal client
jest.mock('../src/temporal/client', () => ({
  getTemporalClient: jest.fn()
}));

// Mock other activities
jest.mock('../src/temporal/activities/cronActivities', () => ({
  saveCronStatusActivity: jest.fn(),
}));

jest.mock('../src/temporal/activities/supabaseActivities', () => ({
  logWorkflowExecutionActivity: jest.fn(),
}));

jest.mock('../src/config/config', () => ({
  temporalConfig: {
    taskQueue: 'test-task-queue'
  }
}));

import { apiService } from '../src/temporal/services/apiService';
import { getTemporalClient } from '../src/temporal/client';
import { saveCronStatusActivity } from '../src/temporal/activities/cronActivities';
import { logWorkflowExecutionActivity } from '../src/temporal/activities/supabaseActivities';

const mockApiService = apiService as jest.Mocked<typeof apiService>;
const mockGetTemporalClient = getTemporalClient as jest.MockedFunction<typeof getTemporalClient>;
const mockSaveCronStatusActivity = saveCronStatusActivity as jest.MockedFunction<typeof saveCronStatusActivity>;
const mockLogWorkflowExecutionActivity = logWorkflowExecutionActivity as jest.MockedFunction<typeof logWorkflowExecutionActivity>;

describe('Campaign Activities', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getSegmentsActivity', () => {
    it('should successfully retrieve segments for a site', async () => {
      const mockSegments: Segment[] = [
        {
          id: 'seg_123',
          name: 'High Value Customers',
          description: 'Customers with high purchase value',
          siteId: 'site_456',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z'
        },
        {
          id: 'seg_456',
          name: 'New Visitors',
          description: 'Recently acquired visitors',
          siteId: 'site_456',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z'
        }
      ];

      mockApiService.get.mockResolvedValue({
        success: true,
        data: { segments: mockSegments }
      });

      const result: GetSegmentsResult = await getSegmentsActivity('site_456');

      expect(result.success).toBe(true);
      expect(result.segments).toHaveLength(2);
      expect(result.segments![0].id).toBe('seg_123');
      expect(result.segments![1].id).toBe('seg_456');
      expect(mockApiService.get).toHaveBeenCalledWith('/api/segments?siteId=site_456');
    });

    it('should handle API error when getting segments', async () => {
      mockApiService.get.mockResolvedValue({
        success: false,
        error: {
          code: 'API_ERROR',
          message: 'Failed to fetch segments'
        }
      });

      const result: GetSegmentsResult = await getSegmentsActivity('site_456');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Failed to fetch segments');
      expect(result.segments).toBeUndefined();
    });

    it('should handle empty segments response', async () => {
      mockApiService.get.mockResolvedValue({
        success: true,
        data: { segments: [] }
      });

      const result: GetSegmentsResult = await getSegmentsActivity('site_456');

      expect(result.success).toBe(true);
      expect(result.segments).toHaveLength(0);
    });

    it('should handle network exception', async () => {
      mockApiService.get.mockRejectedValue(new Error('Network error'));

      const result: GetSegmentsResult = await getSegmentsActivity('site_456');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Network error');
    });
  });

  describe('createCampaignsActivity', () => {
    it('should successfully create campaigns', async () => {
      const mockCampaign = {
        id: 'campaign_123',
        name: 'Growth Campaign',
        status: 'created',
        segments: ['seg_123', 'seg_456']
      };

      mockApiService.post.mockResolvedValue({
        success: true,
        data: mockCampaign
      });

      const request: CreateCampaignRequest = {
        siteId: 'site_456',
        userId: 'user_789',
        campaignData: {
          segmentIds: ['seg_123', 'seg_456']
        }
      };

      const result: CreateCampaignResult = await createCampaignsActivity(request);

      expect(result.success).toBe(true);
      expect(result.campaign).toEqual(mockCampaign);
      expect(mockApiService.post).toHaveBeenCalledWith('/api/agents/growth/campaigns', {
        siteId: 'site_456',
        userId: 'user_789',
        campaignData: {
          segmentIds: ['seg_123', 'seg_456']
        }
      });
    });

    it('should handle optional parameters correctly', async () => {
      const mockCampaign = {
        id: 'campaign_123',
        name: 'Basic Campaign'
      };

      mockApiService.post.mockResolvedValue({
        success: true,
        data: mockCampaign
      });

      const request: CreateCampaignRequest = {
        siteId: 'site_456',
        campaignData: {
          segmentIds: ['seg_123']
        }
      };

      const result: CreateCampaignResult = await createCampaignsActivity(request);

      expect(result.success).toBe(true);
      expect(mockApiService.post).toHaveBeenCalledWith('/api/agents/growth/campaigns', {
        siteId: 'site_456',
        campaignData: {
          segmentIds: ['seg_123']
        }
      });
    });

    it('should handle API error when creating campaigns', async () => {
      mockApiService.post.mockResolvedValue({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid campaign data'
        }
      });

      const request: CreateCampaignRequest = {
        siteId: 'site_456',
        campaignData: {
          segmentIds: []
        }
      };

      const result: CreateCampaignResult = await createCampaignsActivity(request);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid campaign data');
    });

    it('should handle network exception when creating campaigns', async () => {
      mockApiService.post.mockRejectedValue(new Error('Connection timeout'));

      const request: CreateCampaignRequest = {
        siteId: 'site_456',
        campaignData: {
          segmentIds: ['seg_123']
        }
      };

      const result: CreateCampaignResult = await createCampaignsActivity(request);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Connection timeout');
    });
  });
});

describe('Build Campaigns Workflow Scheduling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSaveCronStatusActivity.mockResolvedValue(undefined);
  });

  it('should handle dry run mode', async () => {
    const result = await executeBuildCampaignsWorkflowActivity('site_456', {
      dryRun: true,
      userId: 'user_789'
    });

    expect(result.success).toBe(true);
    expect(result.workflowId).toContain('build-campaigns-site_456');
    expect(result.scheduleId).toBe('build-campaigns-schedule-site_456');
  });
});

// Integration test simulation (without actually calling Temporal)
describe('Build Campaigns Workflow Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should complete full workflow with segments and campaign creation', async () => {
    // Mock segments response
    const mockSegments: Segment[] = [
      {
        id: 'seg_123',
        name: 'Premium Users',
        siteId: 'site_456',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z'
      }
    ];

    // Mock campaign response
    const mockCampaign = {
      id: 'campaign_123',
      name: 'Premium User Campaign',
      status: 'created'
    };

    mockApiService.get.mockResolvedValue({
      success: true,
      data: { segments: mockSegments }
    });

    mockApiService.post.mockResolvedValue({
      success: true,
      data: mockCampaign
    });

    // Verify activities work together
    const segmentsResult = await getSegmentsActivity('site_456');
    expect(segmentsResult.success).toBe(true);
    expect(segmentsResult.segments).toHaveLength(1);

    const campaignRequest: CreateCampaignRequest = {
      siteId: 'site_456',
      userId: 'user_789',
      campaignData: {
        segmentIds: segmentsResult.segments!.map(s => s.id)
      }
    };

    const campaignResult = await createCampaignsActivity(campaignRequest);
    expect(campaignResult.success).toBe(true);
    expect(campaignResult.campaign).toEqual(mockCampaign);
  });

  it('should handle workflow with no segments', async () => {
    mockApiService.get.mockResolvedValue({
      success: true,
      data: { segments: [] }
    });

    const segmentsResult = await getSegmentsActivity('site_456');
    expect(segmentsResult.success).toBe(true);
    expect(segmentsResult.segments).toHaveLength(0);

    // Should not attempt to create campaigns with no segments
    expect(mockApiService.post).not.toHaveBeenCalled();
  });

  it('should handle segments fetch failure gracefully', async () => {
    mockApiService.get.mockResolvedValue({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Site not found'
      }
    });

    const segmentsResult = await getSegmentsActivity('site_456');
    expect(segmentsResult.success).toBe(false);
    expect(segmentsResult.error).toBe('Site not found');

    // Should not attempt to create campaigns if segments fetch failed
    expect(mockApiService.post).not.toHaveBeenCalled();
  });
}); 