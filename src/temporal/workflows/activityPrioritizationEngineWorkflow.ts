import { executeChild } from '@temporalio/workflow';

/**
 * Activity Prioritization Engine Workflow
 * Decides WHETHER to execute daily operations based on business logic
 * If YES → executes dailyOperationsWorkflow
 */
export async function activityPrioritizationEngineWorkflow(): Promise<{
  shouldExecute: boolean;
  reason: string;
  operationsExecuted: boolean;
  operationsResult?: any;
  executionTime: string;
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
    
    // Decision logic: Execute operations or not
    let shouldExecute = false;
    let reason = '';
    
    // For now, simple logic: execute on weekdays (Monday-Friday)
    // This is where you can add more sophisticated business logic
    if (dayOfWeek >= 1 && dayOfWeek <= 5) {
      shouldExecute = true;
      reason = `Weekday execution (${dayName}) - operations should run`;
    } else {
      shouldExecute = false;
      reason = `Weekend (${dayName}) - skipping operations`;
    }
    
    console.log(`📋 Decision: ${shouldExecute ? '✅ EXECUTE' : '⏭️ SKIP'}`);
    console.log(`📝 Reason: ${reason}`);

    let operationsResult;
    let operationsExecuted = false;

    // Step 2: Execute operations if decision is YES
    if (shouldExecute) {
      console.log('🚀 Step 2: Executing daily operations workflow...');
      
      try {
        operationsResult = await executeChild('dailyOperationsWorkflow', {
          workflowId: `daily-operations-${Date.now()}`,
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
      executionTime
    };

  } catch (error) {
    console.error('❌ Activity prioritization engine workflow failed:', error);
    throw error;
  }
} 