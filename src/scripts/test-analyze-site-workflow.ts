#!/usr/bin/env node

/**
 * Test script for the enhanced analyzeSiteWorkflow
 * Tests both settings update from deep research and UX analysis API call
 */

import { getTemporalClient } from '../temporal/client';
import { analyzeSiteWorkflow } from '../temporal/workflows/analyzeSiteWorkflow';

async function testAnalyzeSiteWorkflow() {
  console.log('🚀 Starting analyzeSiteWorkflow test...');

  const client = await getTemporalClient();

  const testSiteId = process.env.TEST_SITE_ID || 'test-site-001';
  const testUserId = process.env.TEST_USER_ID || 'test-user-001';

  try {
    console.log(`\n📋 Test Configuration:`);
    console.log(`   - Site ID: ${testSiteId}`);
    console.log(`   - User ID: ${testUserId}`);
    console.log(`   - Temporal Address: ${process.env.TEMPORAL_ADDRESS || 'localhost:7233'}`);

    // Start the workflow
    const workflowId = `test-analyze-site-${testSiteId}-${Date.now()}`;
    
    console.log(`\n⚡ Starting workflow: ${workflowId}`);
    
    const handle = await client.workflow.start(analyzeSiteWorkflow, {
      args: [{
        site_id: testSiteId,
        userId: testUserId,
        additionalData: {
          testMode: true,
          testDescription: 'Testing enhanced analyzeSiteWorkflow with settings update and UX analysis'
        }
      }],
      workflowId,
      taskQueue: 'default',
    });

    console.log(`✅ Workflow started successfully`);
    console.log(`   - Workflow ID: ${handle.workflowId}`);
    console.log(`   - Run ID: ${handle.firstExecutionRunId}`);

    // Wait for the workflow to complete
    console.log(`\n⏳ Waiting for workflow to complete...`);
    const startTime = Date.now();
    
    const result = await handle.result();
    
    const executionTime = ((Date.now() - startTime) / 1000).toFixed(2);
    
    console.log(`\n🎉 Workflow completed in ${executionTime} seconds!`);
    console.log(`\n📊 Results Summary:`);
    console.log(`   - Success: ${result.success}`);
    console.log(`   - Site: ${result.siteName} (${result.siteUrl})`);
    console.log(`   - Deep Research: ${result.deepResearchResult?.success ? '✅' : '❌'}`);
    console.log(`   - UX Analysis: ${result.uxAnalysisResult?.success ? '✅' : '❌'}`);
    console.log(`   - Settings Updated: ${result.settingsUpdates ? Object.keys(result.settingsUpdates).length + ' fields' : 'None needed'}`);
    console.log(`   - Notification Sent: ${result.notificationResult?.success ? '✅' : result.notificationResult ? '❌' : 'Skipped'}`);
    console.log(`   - Errors: ${result.errors.length}`);
    console.log(`   - Execution Time: ${result.executionTime}`);

    if (result.errors.length > 0) {
      console.log(`\n⚠️  Errors encountered:`);
      result.errors.forEach((error: string, index: number) => {
        console.log(`   ${index + 1}. ${error}`);
      });
    }

    // Log detailed results
    if (result.deepResearchResult?.success) {
      console.log(`\n🔍 Deep Research Details:`);
      console.log(`   - Operations: ${result.deepResearchResult.data?.operations?.length || 0}`);
      console.log(`   - Insights: ${result.deepResearchResult.data?.insights?.length || 0}`);
      console.log(`   - Recommendations: ${result.deepResearchResult.data?.recommendations?.length || 0}`);
    }

    if (result.uxAnalysisResult?.success) {
      console.log(`\n🎨 UX Analysis Details:`);
      console.log(`   - Analysis Data: ${result.uxAnalysisResult.data ? 'Available' : 'Not available'}`);
    }

    if (result.notificationResult) {
      console.log(`\n🔔 Notification Details:`);
      console.log(`   - Success: ${result.notificationResult.success ? '✅' : '❌'}`);
      if (result.notificationResult.success) {
        console.log(`   - Notification Data: ${result.notificationResult.data ? 'Available' : 'Not available'}`);
      } else {
        console.log(`   - Error: ${result.notificationResult.error || 'Unknown error'}`);
      }
    }

    if (result.settingsUpdates) {
      console.log(`\n📝 Settings Updates:`);
      Object.keys(result.settingsUpdates).forEach(key => {
        const value = result.settingsUpdates[key];
        let valueDescription;
        
        if (Array.isArray(value)) {
          valueDescription = `${value.length} items`;
        } else if (typeof value === 'object' && value !== null) {
          valueDescription = `${Object.keys(value).length} properties`;
        } else {
          valueDescription = String(value).substring(0, 100) + (String(value).length > 100 ? '...' : '');
        }
        
        console.log(`   - ${key}: ${valueDescription}`);
      });
    }

    console.log(`\n✅ Test completed successfully!`);
    
    return result;

  } catch (error) {
    console.error(`\n❌ Test failed:`, error);
    
    if (error instanceof Error) {
      console.error(`   - Error: ${error.message}`);
      console.error(`   - Stack: ${error.stack}`);
    }
    
    throw error;
  }
}

// Run the test
if (require.main === module) {
  testAnalyzeSiteWorkflow()
    .then(() => {
      console.log('\n🎉 All tests passed!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Test failed:', error);
      process.exit(1);
    });
}

export { testAnalyzeSiteWorkflow }; 