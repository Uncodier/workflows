#!/usr/bin/env tsx

/**
 * Test script for Activity Prioritization Engine - CORRECTED VERSION
 * Tests the actual workflow with site analysis functionality
 */

import { getTemporalClient } from '../temporal/client';

async function testActivityPrioritizationCorrected() {
  console.log('🎯 Testing Activity Prioritization Engine - CORRECTED VERSION');
  console.log('='.repeat(70));
  console.log('✅ This tests the actual workflow with site analysis validation');
  console.log('='.repeat(70));

  try {
    const client = await getTemporalClient();
    
    console.log('\n🚀 Starting activityPrioritizationEngineWorkflow...');
    
    // Start the workflow with a unique ID
    const workflowId = `activity-prioritization-corrected-${Date.now()}`;
    
    const handle = await client.workflow.start('activityPrioritizationEngineWorkflow', {
      args: [], // No arguments needed
      workflowId,
      taskQueue: 'default',
      workflowRunTimeout: '10 minutes',
    });

    console.log(`✅ Workflow started with ID: ${workflowId}`);
    console.log('⏳ Waiting for workflow to complete...');
    
    // Wait for the result
    const result = await handle.result();
    
    console.log('\n🎉 Workflow completed successfully!');
    console.log('📊 Activity Prioritization Results:');
    console.log(`   - Should Execute: ${result.shouldExecute ? '✅ YES' : '❌ NO'}`);
    console.log(`   - Reason: ${result.reason}`);
    console.log(`   - Timing Decision: ${result.timingDecision?.toUpperCase() || 'N/A'}`);
    console.log(`   - Operations Executed: ${result.operationsExecuted ? '✅ YES' : '❌ NO'}`);
    console.log(`   - Execution Time: ${result.executionTime}`);
    
    if (result.scheduledForTime) {
      console.log(`   - Scheduled For: ${result.scheduledForTime}`);
    }
    
    // Show business hours analysis
    if (result.businessHoursAnalysis) {
      console.log('\n🏢 Business Hours Analysis:');
      console.log(`   - Sites with business hours: ${result.businessHoursAnalysis.sitesWithBusinessHours}`);
      console.log(`   - Sites open today: ${result.businessHoursAnalysis.sitesOpenToday}`);
      console.log(`   - Should execute now: ${result.businessHoursAnalysis.shouldExecuteNow ? '✅' : '❌'}`);
      console.log(`   - Should schedule for later: ${result.businessHoursAnalysis.shouldScheduleForLater ? '✅' : '❌'}`);
      
      if (result.businessHoursAnalysis.currentTimeAnalysis) {
        const timeAnalysis = result.businessHoursAnalysis.currentTimeAnalysis;
        console.log(`   - Current time: ${timeAnalysis.currentHour}:${timeAnalysis.currentMinute.toString().padStart(2, '0')} ${timeAnalysis.timezone}`);
        console.log(`   - Sites currently open: ${timeAnalysis.sitesCurrentlyOpen}`);
      }
    }
    
    // Show operations result details
    if (result.operationsResult) {
      console.log('\n🔄 Operations Results:');
      
      // Site Analysis Scheduling (NEW FEATURE)
      if (result.operationsResult.siteAnalysisScheduling) {
        const siteAnalysis = result.operationsResult.siteAnalysisScheduling;
        console.log('\n🔍 Site Analysis Scheduling (NEW):');
        console.log(`   - ✅ Scheduled: ${siteAnalysis.scheduled} sites for analysis`);
        console.log(`   - ⏭️  Skipped: ${siteAnalysis.skipped} sites (already analyzed)`);
        console.log(`   - ❌ Failed: ${siteAnalysis.failed} sites`);
        
        if (siteAnalysis.errors && siteAnalysis.errors.length > 0) {
          console.log(`   - Errors: ${siteAnalysis.errors.length}`);
          siteAnalysis.errors.forEach((error: string, index: number) => {
            console.log(`     ${index + 1}. ${error}`);
          });
        }
      }
      
      // Individual Schedules
      if (result.operationsResult.individualSchedules) {
        console.log('\n📅 Individual Scheduling:');
        console.log(`   - Individual schedules created: ${result.operationsResult.individualSchedules}`);
        console.log(`   - Failed schedules: ${result.operationsResult.failedSchedules || 0}`);
        console.log(`   - Approach: ${result.operationsResult.approach || 'N/A'}`);
      }
      
      // Global operations
      if (result.operationsResult.success !== undefined) {
        console.log('\n🌐 Global Operations:');
        console.log(`   - Success: ${result.operationsResult.success ? '✅' : '❌'}`);
        if (result.operationsResult.error) {
          console.log(`   - Error: ${result.operationsResult.error}`);
        }
      }
    }
    
    console.log('\n✅ Test completed successfully!');
    console.log('\n📝 Summary:');
    console.log(`   - Workflow execution: ${result.shouldExecute ? 'EXECUTED' : 'SKIPPED/SCHEDULED'}`);
    console.log(`   - Site analysis validation: ${result.operationsResult?.siteAnalysisScheduling ? 'ACTIVE' : 'NOT EXECUTED'}`);
    console.log(`   - Business hours respected: ${result.businessHoursAnalysis ? 'YES' : 'NO'}`);
    console.log(`   - Total execution time: ${result.executionTime}`);
    
    return result;

  } catch (error) {
    console.error('\n❌ Test failed:', error);
    throw error;
  }
}

// Run the test if this script is executed directly
if (require.main === module) {
  testActivityPrioritizationCorrected()
    .then(() => {
      console.log('\n👋 Test completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Test failed:', error);
      process.exit(1);
    });
}

export { testActivityPrioritizationCorrected }; 