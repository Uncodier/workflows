import { executeChild, proxyActivities } from '@temporalio/workflow';
import type { Activities } from '../activities';

const { evaluateBusinessHoursForDay } = proxyActivities<Activities>({
  startToCloseTimeout: '10 minutes',
});

/**
 * Activity Prioritization Engine Workflow
 * Decides WHETHER to execute daily operations based on business logic
 * Now considers business_hours from database for smarter scheduling
 * If YES → executes dailyOperationsWorkflow
 */
export async function activityPrioritizationEngineWorkflow(): Promise<{
  shouldExecute: boolean;
  reason: string;
  operationsExecuted: boolean;
  operationsResult?: any;
  executionTime: string;
  businessHoursAnalysis?: any;
}> {
  console.log('🎯 Starting activity prioritization engine workflow...');
  const startTime = new Date();

  try {
    // Step 1: Decision Logic - Should we execute operations today?
    console.log('🤔 Step 1: Analyzing if operations should execute today...');
    
    const today = new Date();
    const dayOfWeek = today.getDay(); // 0=Sunday, 1=Monday, etc.
    const dayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dayOfWeek];
    const currentHour = today.getHours();
    
    console.log(`📅 Today is ${dayName} (${dayOfWeek}) at ${currentHour}:${today.getMinutes().toString().padStart(2, '0')}`);
    
    // NEW: Evaluate business hours from database
    console.log('🏢 Evaluating business hours from database...');
    const businessHoursAnalysis = await evaluateBusinessHoursForDay(dayOfWeek);
    
    console.log('📊 Business Hours Analysis:');
    console.log(`   - Sites with business_hours: ${businessHoursAnalysis.sitesWithBusinessHours}`);
    console.log(`   - Sites open today: ${businessHoursAnalysis.sitesOpenToday}`);
    console.log(`   - Decision: ${businessHoursAnalysis.shouldExecuteOperations ? 'EXECUTE' : 'SKIP'}`);
    console.log(`   - Reason: ${businessHoursAnalysis.reason}`);
    
    if (businessHoursAnalysis.openSites.length > 0) {
      console.log('   - Open sites today:');
      businessHoursAnalysis.openSites.forEach(site => {
        console.log(`     • Site ${site.siteId}: ${site.businessHours.open} - ${site.businessHours.close}`);
      });
    }
    
    const shouldExecute = businessHoursAnalysis.shouldExecuteOperations;
    const reason = businessHoursAnalysis.reason;
    
    console.log(`📋 Final Decision: ${shouldExecute ? '✅ EXECUTE' : '⏭️ SKIP'}`);
    console.log(`📝 Reason: ${reason}`);

    let operationsResult;
    let operationsExecuted = false;

    // Step 2: Execute operations if decision is YES
    if (shouldExecute) {
      console.log('🚀 Step 2: Executing daily operations workflow...');
      
      try {
        operationsResult = await executeChild('dailyOperationsWorkflow', {
          workflowId: `daily-operations-${Date.now()}`,
          args: [{ businessHoursAnalysis }],
        });
        
        operationsExecuted = true;
        console.log('✅ Daily operations workflow completed successfully');
      } catch (operationsError) {
        console.error('❌ Daily operations workflow failed:', operationsError);
        operationsResult = {
          error: operationsError instanceof Error ? operationsError.message : String(operationsError)
        };
      }
    } else {
      console.log('⏭️ Step 2: Skipping daily operations (decision was NO)');
    }

    const endTime = new Date();
    const executionTime = `${endTime.getTime() - startTime.getTime()}ms`;

    console.log('🎉 Activity prioritization engine workflow completed');
    console.log(`   Decision: ${shouldExecute ? 'EXECUTE' : 'SKIP'}`);
    console.log(`   Operations executed: ${operationsExecuted ? 'YES' : 'NO'}`);
    console.log(`   Total execution time: ${executionTime}`);
    console.log('   Role: Decision maker and orchestrator');
    
    return {
      shouldExecute,
      reason,
      operationsExecuted,
      operationsResult,
      executionTime,
      businessHoursAnalysis
    };

  } catch (error) {
    console.error('❌ Activity prioritization engine workflow failed:', error);
    throw error;
  }
} 