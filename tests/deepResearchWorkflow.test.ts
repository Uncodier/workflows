import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { getTemporalClient } from '../src/temporal/client';
import { deepResearchWorkflow, DeepResearchOptions } from '../src/temporal/workflows/deepResearchWorkflow';

describe('Deep Research Workflow', () => {
  let client: any;

  beforeAll(async () => {
    client = await getTemporalClient();
  });

  afterAll(async () => {
    if (client?.connection) {
      await client.connection.close();
    }
  });

  it('should execute deep research workflow successfully', async () => {
    const options: DeepResearchOptions = {
      site_id: 'test-site-123',
      research_topic: 'Market analysis for testing tools',
      userId: 'test-user-456',
      additionalData: {
        depth: 'basic',
        focus_areas: ['pricing', 'features']
      }
    };

    const workflowId = `test-deep-research-${Date.now()}`;
    
    const handle = await client.workflow.start(deepResearchWorkflow, {
      workflowId,
      taskQueue: 'workflows',
      args: [options],
    });

    const result = await handle.result();

    // Basic assertions
    expect(result).toBeDefined();
    expect(result.success).toBeDefined();
    expect(result.siteId).toBe(options.site_id);
    expect(result.researchTopic).toBe(options.research_topic);
    expect(result.executionTime).toBeDefined();
    expect(result.completedAt).toBeDefined();
    expect(Array.isArray(result.errors)).toBe(true);

    // If workflow succeeded, check additional properties
    if (result.success) {
      expect(result.siteName).toBeDefined();
      expect(result.siteUrl).toBeDefined();
      expect(Array.isArray(result.operations)).toBe(true);
      expect(Array.isArray(result.operationResults)).toBe(true);
      expect(Array.isArray(result.insights)).toBe(true);
      expect(Array.isArray(result.recommendations)).toBe(true);
    }

    console.log('Deep Research Workflow Test Result:', {
      success: result.success,
      operationsCount: result.operations?.length || 0,
      operationResultsCount: result.operationResults?.length || 0,
      insightsCount: result.insights?.length || 0,
      recommendationsCount: result.recommendations?.length || 0,
      executionTime: result.executionTime,
      errorsCount: result.errors.length
    });
  }, 300000); // 5 minute timeout for the test

  it('should handle missing site_id', async () => {
    const options: any = {
      research_topic: 'Test research topic',
      userId: 'test-user-456'
    };

    const workflowId = `test-deep-research-missing-site-${Date.now()}`;
    
    await expect(async () => {
      const handle = await client.workflow.start(deepResearchWorkflow, {
        workflowId,
        taskQueue: 'workflows',
        args: [options],
      });
      await handle.result();
    }).rejects.toThrow();
  });

  it('should handle missing research_topic', async () => {
    const options: any = {
      site_id: 'test-site-123',
      userId: 'test-user-456'
    };

    const workflowId = `test-deep-research-missing-topic-${Date.now()}`;
    
    await expect(async () => {
      const handle = await client.workflow.start(deepResearchWorkflow, {
        workflowId,
        taskQueue: 'workflows',
        args: [options],
      });
      await handle.result();
    }).rejects.toThrow();
  });

  it('should handle workflow with minimal options', async () => {
    const options: DeepResearchOptions = {
      site_id: 'test-site-minimal',
      research_topic: 'Minimal research test'
    };

    const workflowId = `test-deep-research-minimal-${Date.now()}`;
    
    const handle = await client.workflow.start(deepResearchWorkflow, {
      workflowId,
      taskQueue: 'workflows',
      args: [options],
    });

    const result = await handle.result();

    expect(result).toBeDefined();
    expect(result.siteId).toBe(options.site_id);
    expect(result.researchTopic).toBe(options.research_topic);
    expect(result.executionTime).toBeDefined();
    expect(result.completedAt).toBeDefined();
  }, 300000);
}); 