#!/usr/bin/env tsx

/**
 * Test script for Deep Research Workflow
 * 
 * This script tests the deepResearchWorkflow which:
 * 1. Calls /api/agents/dataAnalyst/deepResearch to get operations
 * 2. Executes each operation via /api/agents/dataAnalyst/search
 * 3. Performs final analysis via /api/agents/dataAnalyst/analysis
 */

import { getTemporalClient } from '../temporal/client';
import { deepResearchWorkflow } from '../temporal/workflows/deepResearchWorkflow';

async function testDeepResearchWorkflow() {
  console.log('🔬 Testing Deep Research Workflow...');
  
  try {
    // Test configuration - replace with actual values
    const testOptions = {
      site_id: 'test-site-123',
      research_topic: 'Market analysis for SaaS tools',
      userId: 'test-user-456',
      additionalData: {
        depth: 'comprehensive',
        focus_areas: ['competitors', 'pricing', 'features', 'market_trends']
      }
    };

    console.log('📋 Test Configuration:');
    console.log(JSON.stringify(testOptions, null, 2));
    console.log('');

    // Execute the workflow
    console.log('🚀 Starting Deep Research Workflow execution...');
    const workflowId = `test-deep-research-${Date.now()}`;
    
    const client = await getTemporalClient();
    const handle = await client.workflow.start(deepResearchWorkflow, {
      workflowId,
      taskQueue: 'workflows',
      args: [testOptions],
    });

    console.log(`📊 Workflow started with ID: ${workflowId}`);
    console.log('⏳ Waiting for workflow completion...');

    // Wait for the workflow to complete
    const result = await handle.result();

    console.log('');
    console.log('🎉 Deep Research Workflow completed!');
    console.log('📊 Results:');
    console.log(`   ✅ Success: ${result.success}`);
    console.log(`   🏢 Site: ${result.siteName} (${result.siteUrl})`);
    console.log(`   🔬 Research Topic: ${result.researchTopic}`);
    console.log(`   ⚙️ Operations Executed: ${result.operationResults?.length || 0}`);
    console.log(`   🔍 Insights Generated: ${result.insights?.length || 0}`);
    console.log(`   💡 Recommendations: ${result.recommendations?.length || 0}`);
    console.log(`   ⏱️ Execution Time: ${result.executionTime}`);
    console.log(`   📅 Completed At: ${result.completedAt}`);

    if (result.errors && result.errors.length > 0) {
      console.log('');
      console.log('⚠️ Warnings/Errors:');
      result.errors.forEach((error: string, index: number) => {
        console.log(`   ${index + 1}. ${error}`);
      });
    }

    if (result.operations && result.operations.length > 0) {
      console.log('');
      console.log('🔧 Operations Generated:');
      result.operations.forEach((operation: any, index: number) => {
        console.log(`   ${index + 1}. ${operation.type || operation.description || `Operation ${index + 1}`}`);
      });
    }

    if (result.operationResults && result.operationResults.length > 0) {
      console.log('');
      console.log('📊 Operation Results Summary:');
      const successful = result.operationResults.filter((r: any) => r.success).length;
      const failed = result.operationResults.filter((r: any) => !r.success).length;
      console.log(`   ✅ Successful: ${successful}`);
      console.log(`   ❌ Failed: ${failed}`);
    }

    if (result.insights && result.insights.length > 0) {
      console.log('');
      console.log('🔍 Key Insights:');
      result.insights.slice(0, 3).forEach((insight: any, index: number) => {
        const text = typeof insight === 'string' ? insight : insight.text || insight.description || insight.title || JSON.stringify(insight);
        console.log(`   ${index + 1}. ${text.substring(0, 100)}${text.length > 100 ? '...' : ''}`);
      });
      if (result.insights.length > 3) {
        console.log(`   ... and ${result.insights.length - 3} more insights`);
      }
    }

    if (result.recommendations && result.recommendations.length > 0) {
      console.log('');
      console.log('💡 Key Recommendations:');
      result.recommendations.slice(0, 3).forEach((rec: any, index: number) => {
        const text = typeof rec === 'string' ? rec : rec.text || rec.description || rec.title || JSON.stringify(rec);
        console.log(`   ${index + 1}. ${text.substring(0, 100)}${text.length > 100 ? '...' : ''}`);
      });
      if (result.recommendations.length > 3) {
        console.log(`   ... and ${result.recommendations.length - 3} more recommendations`);
      }
    }

    console.log('');
    console.log('📄 Full Result Object:');
    console.log(JSON.stringify(result, null, 2));

    if (result.success) {
      console.log('');
      console.log('✅ Deep Research Workflow test completed successfully!');
      process.exit(0);
    } else {
      console.log('');
      console.log('❌ Deep Research Workflow test failed!');
      process.exit(1);
    }

  } catch (error) {
    console.error('');
    console.error('💥 Error running Deep Research Workflow test:');
    console.error(error);
    process.exit(1);
  }
}

// Handle process termination gracefully
process.on('SIGINT', () => {
  console.log('\n🛑 Test interrupted by user');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Test terminated');
  process.exit(0);
});

// Run the test
testDeepResearchWorkflow().catch(console.error); 