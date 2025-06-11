#!/usr/bin/env node
import { getTemporalClient } from '../temporal/client';
import { workflows } from '../temporal/workflows';

async function run() {
  // Use the configured Temporal client
  const client = await getTemporalClient();

  // Test parameters for buildSegmentsICPWorkflow
  const testParams = {
    site_id: "9be0a6a2-5567-41bf-ad06-cb4014f0faf2", // Replace with actual site ID
    userId: "test-user-id", // Optional: replace with actual user ID
    // segmentIds: ["segment-1", "segment-2"], // Optional: specific segment IDs
    aiProvider: "openai" as const, // Optional: AI provider
    aiModel: "gpt-4" // Optional: AI model
  };

  console.log('🚀 Testing buildSegmentsICPWorkflow with new child workflow approach...');
  console.log('📊 Test parameters:', JSON.stringify(testParams, null, 2));

  try {
    const handle = await client.workflow.start(workflows.buildSegmentsICPWorkflow, {
      taskQueue: 'default',
      workflowId: 'test-build-segments-icp-' + Date.now(),
      args: [testParams],
    });

    console.log('✅ Started workflow:', handle.workflowId);
    console.log('⏳ Waiting for workflow completion...');
    
    // Wait for the result
    const result = await handle.result();
    console.log('\n📈 Workflow result:', JSON.stringify(result, null, 2));
    
    if (result.success) {
      console.log('\n🎉 Workflow completed successfully!');
      console.log(`📊 Summary:`);
      console.log(`   - Site: ${result.siteName} (${result.siteId})`);
      console.log(`   - ICP Segments built: ${result.icpSegmentsBuilt}`);
      console.log(`   - Total segments processed: ${result.segmentIds.length}`);
      console.log(`   - Execution time: ${result.executionTime}`);
      
             if (result.errors.length > 0) {
         console.log(`⚠️ Errors encountered: ${result.errors.length}`);
         result.errors.forEach((error: string, index: number) => {
           console.log(`   ${index + 1}. ${error}`);
         });
       }
       
       if (result.segments && result.segments.length > 0) {
         console.log(`\n🎯 ICP Segments created:`);
         result.segments.forEach((segment: any, index: number) => {
           console.log(`   ${index + 1}. ${segment.name || segment.title || `ICP Segment ${index + 1}`}`);
         });
       }
    } else {
      console.log('\n❌ Workflow completed with errors');
      console.log(`💥 Errors: ${result.errors.join('; ')}`);
    }
    
  } catch (error) {
    console.error('\n💥 Workflow execution failed:', error);
    process.exit(1);
  }
}

// Test individual segment workflow as well
async function testSingleSegment() {
  const client = await getTemporalClient();
  
  const testParams = {
    siteId: "9be0a6a2-5567-41bf-ad06-cb4014f0faf2",
    segmentId: "test-segment-id",
    segmentName: "Test Segment",
    userId: "test-user-id"
  };

  console.log('\n🔄 Testing buildSingleSegmentICPWorkflow...');
  console.log('📊 Test parameters:', JSON.stringify(testParams, null, 2));

  try {
    const handle = await client.workflow.start(workflows.buildSingleSegmentICPWorkflow, {
      taskQueue: 'default',
      workflowId: 'test-single-segment-icp-' + Date.now(),
      args: [testParams],
    });

    console.log('✅ Started single segment workflow:', handle.workflowId);
    
    const result = await handle.result();
    console.log('\n📈 Single segment result:', JSON.stringify(result, null, 2));
    
    if (result.success) {
      console.log('\n🎉 Single segment workflow completed successfully!');
      console.log(`📊 Summary:`);
      console.log(`   - Segment: ${result.segmentName} (${result.segmentId})`);
      console.log(`   - Execution time: ${result.executionTime}`);
    } else {
      console.log('\n❌ Single segment workflow failed:', result.error);
    }
    
  } catch (error) {
    console.error('\n💥 Single segment workflow execution failed:', error);
  }
}

run()
  .then(() => testSingleSegment())
  .catch((err) => {
    console.error('💥 Failed to execute workflow tests:', err);
    process.exit(1);
  }); 