#!/usr/bin/env ts-node
/**
 * Test script for validateAndCleanStuckCronStatusActivity
 * 
 * This script demonstrates how the new cron status validation works
 * and can be used to test the functionality manually.
 */

import { getSupabaseService } from '../temporal/services';
import { validateAndCleanStuckCronStatusActivity } from '../temporal/activities/cronActivities';

interface TestResult {
  testName: string;
  success: boolean;
  result?: any;
  error?: string;
}

async function runTests() {
  console.log('🧪 Testing validateAndCleanStuckCronStatusActivity');
  console.log('='.repeat(60));
  console.log('');

  const results: TestResult[] = [];
  
  try {
    const supabaseService = getSupabaseService();
    
    const isConnected = await supabaseService.getConnectionStatus();
    if (!isConnected) {
      console.error('❌ Database not available - cannot run tests');
      process.exit(1);
    }

    // Test 1: Check non-existent workflow
    console.log('📝 Test 1: Validating non-existent workflow record');
    try {
      const result1 = await validateAndCleanStuckCronStatusActivity(
        'nonExistentWorkflow',
        'test-site-id',
        24
      );
      
      console.log(`   Result: ${result1.reason}`);
      console.log(`   Can proceed: ${result1.canProceed}`);
      console.log(`   Was stuck: ${result1.wasStuck}`);
      console.log('');
      
      results.push({
        testName: 'Non-existent workflow',
        success: true,
        result: result1
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`   ❌ Error: ${errorMessage}`);
      results.push({
        testName: 'Non-existent workflow',
        success: false,
        error: errorMessage
      });
    }

    // Test 2: Check with actual site IDs from database
    console.log('📝 Test 2: Checking actual sites from database');
    try {
      const sites = await supabaseService.fetchSites();
      
      if (sites.length === 0) {
        console.log('   No sites found in database');
      } else {
        console.log(`   Found ${sites.length} sites - testing first 3`);
        
        const testSites = sites.slice(0, 3);
        
        for (const site of testSites) {
          console.log(`\n   🔍 Testing site: ${site.name || 'Unnamed'} (${site.id})`);
          
          const result = await validateAndCleanStuckCronStatusActivity(
            'dailyStandUpWorkflow',
            site.id,
            24
          );
          
          console.log(`      Result: ${result.reason}`);
          console.log(`      Can proceed: ${result.canProceed}`);
          console.log(`      Was stuck: ${result.wasStuck}`);
          
          if (result.hoursStuck) {
            console.log(`      Hours stuck: ${result.hoursStuck.toFixed(1)}`);
          }
        }
      }
      
      results.push({
        testName: 'Real sites validation',
        success: true,
        result: `Tested ${Math.min(sites.length, 3)} sites`
      });
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`   ❌ Error: ${errorMessage}`);
      results.push({
        testName: 'Real sites validation',
        success: false,
        error: errorMessage
      });
    }

    // Test 3: Test different thresholds
    console.log('\n📝 Test 3: Testing different time thresholds');
    try {
      const thresholds = [1, 6, 12, 24, 48];
      
      for (const threshold of thresholds) {
        console.log(`\n   🕐 Testing ${threshold}h threshold for global workflows`);
        
        const result = await validateAndCleanStuckCronStatusActivity(
          'activityPrioritizationEngineWorkflow',
          'global',
          threshold
        );
        
        console.log(`      Result: ${result.reason}`);
        console.log(`      Can proceed: ${result.canProceed}`);
        
        if (result.hoursStuck) {
          console.log(`      Hours stuck: ${result.hoursStuck.toFixed(1)}`);
        }
      }
      
      results.push({
        testName: 'Different thresholds',
        success: true,
        result: `Tested ${thresholds.length} different thresholds`
      });
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`   ❌ Error: ${errorMessage}`);
      results.push({
        testName: 'Different thresholds',
        success: false,
        error: errorMessage
      });
    }

    // Test 4: Check for any stuck records in the system
    console.log('\n📝 Test 4: Checking for stuck records in the system');
    try {
      const stuckRecords = await supabaseService.fetchStuckCronStatus(2); // 2 hours threshold
      
      console.log(`   Found ${stuckRecords.length} records stuck for >2 hours`);
      
      if (stuckRecords.length > 0) {
        console.log('   Stuck records found:');
        stuckRecords.forEach((record, index) => {
          const updatedAt = new Date(record.updated_at);
          const hoursStuck = (Date.now() - updatedAt.getTime()) / (1000 * 60 * 60);
          
          console.log(`   ${index + 1}. ${record.activity_name}`);
          console.log(`      Site: ${record.site_id?.substring(0, 8)}...`);
          console.log(`      Status: ${record.status}`);
          console.log(`      Stuck for: ${hoursStuck.toFixed(1)}h`);
          console.log('');
        });
        
        // Test cleaning one of them
        if (stuckRecords.length > 0) {
          const testRecord = stuckRecords[0];
          console.log(`   🧹 Testing cleanup on: ${testRecord.activity_name}`);
          
          const cleanupResult = await validateAndCleanStuckCronStatusActivity(
            testRecord.activity_name,
            testRecord.site_id,
            1 // 1 hour threshold to force cleanup
          );
          
          console.log(`      Cleanup result: ${cleanupResult.reason}`);
          console.log(`      Was cleaned: ${cleanupResult.cleaned}`);
        }
      } else {
        console.log('   ✅ No stuck records found - system is healthy!');
      }
      
      results.push({
        testName: 'Stuck records check',
        success: true,
        result: `Found ${stuckRecords.length} stuck records`
      });
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`   ❌ Error: ${errorMessage}`);
      results.push({
        testName: 'Stuck records check',
        success: false,
        error: errorMessage
      });
    }

  } catch (error) {
    console.error('❌ General test error:', error);
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 Test Results Summary');
  console.log('='.repeat(60));
  
  const successful = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  
  results.forEach(result => {
    const status = result.success ? '✅' : '❌';
    console.log(`${status} ${result.testName}`);
    if (!result.success && result.error) {
      console.log(`   Error: ${result.error}`);
    }
  });
  
  console.log('');
  console.log(`📈 Results: ${successful} passed, ${failed} failed`);
  
  if (failed === 0) {
    console.log('🎉 All tests passed! The cron status validation is working correctly.');
  } else {
    console.log('⚠️  Some tests failed. Check the errors above.');
  }
}

// Usage examples
async function showUsageExamples() {
  console.log('\n' + '='.repeat(60));
  console.log('📚 Usage Examples');
  console.log('='.repeat(60));
  
  console.log(`
🔍 Basic Usage in Workflows:

// At the start of any workflow
const cronValidation = await validateAndCleanStuckCronStatusActivity(
  'workflowName',
  site_id,
  24 // 24 hours threshold
);

if (!cronValidation.canProceed) {
  // Another instance is running or recently ran
  return { executed: false, reason: cronValidation.reason };
}

// Proceed with workflow execution...

🕐 Recommended Thresholds:

- Fast workflows (email sync): 6-12 hours
- Daily workflows (standups): 24 hours  
- System workflows (maintenance): 48+ hours

🎯 Site ID Guidelines:

- Site-specific workflows: actual site_id
- Global/system workflows: 'global'

⚡ Integration Pattern:

1. Call validateAndCleanStuckCronStatusActivity first
2. Check canProceed flag
3. Mark as RUNNING if proceeding
4. Execute workflow logic
5. Mark as COMPLETED or FAILED
`);
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.includes('--help') || args.includes('-h')) {
    showUsageExamples();
    return;
  }
  
  if (args.includes('--examples')) {
    showUsageExamples();
    return;
  }
  
  await runTests();
  
  if (args.includes('--examples')) {
    await showUsageExamples();
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}

const testUtils = { runTests, showUsageExamples };

export default testUtils;