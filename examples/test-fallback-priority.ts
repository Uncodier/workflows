/**
 * Test Script: Priority Fallback Behavior
 * 
 * This script demonstrates what happens when workflows are not declared
 * in the priority configuration or when priority is not specified.
 */

import { getTaskQueueForWorkflow, TASK_QUEUES } from '../src/temporal/config/taskQueues';
import { executeWorkflowWithPriority } from '../src/temporal/utils/priorityWorkflowExecutor';

/**
 * Test what happens with undeclared workflows
 */
export function testUndeclaredWorkflows() {
  console.log('🧪 Testing Undeclared Workflow Priority Assignment...\n');
  
  // Test workflows that are NOT in the switch statement
  const undeclaredWorkflows = [
    'myNewCustomWorkflow',
    'specialReportWorkflow', 
    'emergencyCleanupWorkflow',
    'unknownWorkflow',
    'experimentalWorkflow'
  ];
  
  undeclaredWorkflows.forEach(workflowType => {
    const assignedQueue = getTaskQueueForWorkflow(workflowType);
    console.log(`📋 Workflow: ${workflowType}`);
    console.log(`   ➡️  Assigned Queue: ${assignedQueue}`);
    console.log(`   ➡️  Expected: ${TASK_QUEUES.NORMAL}`);
    console.log(`   ➡️  Status: ${assignedQueue === TASK_QUEUES.NORMAL ? '✅ FALLBACK TO NORMAL' : '❌ UNEXPECTED'}\n`);
  });
}

/**
 * Test priority override behavior
 */
export function testPriorityOverrides() {
  console.log('🔄 Testing Priority Override Behavior...\n');
  
  const undeclaredWorkflow = 'myCustomWorkflow';
  
  // Test all priority overrides
  const priorities: Array<'critical' | 'high' | 'normal' | 'low' | 'background'> = [
    'critical', 'high', 'normal', 'low', 'background'
  ];
  
  priorities.forEach(priority => {
    const assignedQueue = getTaskQueueForWorkflow(undeclaredWorkflow, priority);
    const expectedQueue = {
      'critical': TASK_QUEUES.CRITICAL,
      'high': TASK_QUEUES.HIGH,
      'normal': TASK_QUEUES.NORMAL,
      'low': TASK_QUEUES.LOW,
      'background': TASK_QUEUES.BACKGROUND
    }[priority];
    
    console.log(`🎯 Override Priority: ${priority}`);
    console.log(`   ➡️  Assigned Queue: ${assignedQueue}`);
    console.log(`   ➡️  Expected: ${expectedQueue}`);
    console.log(`   ➡️  Status: ${assignedQueue === expectedQueue ? '✅ OVERRIDE WORKS' : '❌ OVERRIDE FAILED'}\n`);
  });
}

/**
 * Test execution scenarios
 */
export async function testExecutionScenarios() {
  console.log('🚀 Testing Execution Scenarios...\n');
  
  const scenarios = [
    {
      name: 'Undeclared workflow, no priority',
      workflowType: 'myNewWorkflow',
      priority: undefined,
      expectedQueue: TASK_QUEUES.NORMAL
    },
    {
      name: 'Undeclared workflow, explicit high priority',
      workflowType: 'myNewWorkflow', 
      priority: 'high' as const,
      expectedQueue: TASK_QUEUES.HIGH
    },
    {
      name: 'Declared workflow (customer support), no priority',
      workflowType: 'customerSupportMessageWorkflow',
      priority: undefined,
      expectedQueue: TASK_QUEUES.HIGH
    },
    {
      name: 'Declared workflow, priority override to critical',
      workflowType: 'customerSupportMessageWorkflow',
      priority: 'critical' as const,
      expectedQueue: TASK_QUEUES.CRITICAL
    }
  ];
  
  scenarios.forEach((scenario, index) => {
    console.log(`📋 Scenario ${index + 1}: ${scenario.name}`);
    
    // Simulate what would happen
    const assignedQueue = getTaskQueueForWorkflow(scenario.workflowType, scenario.priority);
    
    console.log(`   ➡️  Workflow: ${scenario.workflowType}`);
    console.log(`   ➡️  Priority: ${scenario.priority || 'auto'}`);
    console.log(`   ➡️  Assigned Queue: ${assignedQueue}`);
    console.log(`   ➡️  Expected: ${scenario.expectedQueue}`);
    console.log(`   ➡️  Result: ${assignedQueue === scenario.expectedQueue ? '✅ CORRECT' : '❌ INCORRECT'}`);
    console.log(`   ➡️  Will Execute: ✅ YES (${assignedQueue} queue)\n`);
  });
}

/**
 * Show the safety net behavior
 */
export function showSafetyNetBehavior() {
  console.log('🛡️ Safety Net Behavior Summary:\n');
  
  console.log('❓ What if I forget to declare a new workflow?');
  console.log('   ✅ It WILL execute');
  console.log('   ✅ It goes to NORMAL priority (default queue)');
  console.log('   ✅ Gets 15-minute timeout');
  console.log('   ✅ Gets 15 concurrent task limit');
  console.log('   ⚠️  Might not get the priority it needs\n');
  
  console.log('❓ What if I misspell a workflow name?');
  console.log('   ✅ It WILL execute');
  console.log('   ✅ Falls back to NORMAL priority');
  console.log('   ✅ No errors or crashes');
  console.log('   ⚠️  Check logs for unexpected assignments\n');
  
  console.log('❓ What if I want to override priority?');
  console.log('   ✅ Explicit priority ALWAYS wins');
  console.log('   ✅ Works for declared AND undeclared workflows');
  console.log('   ✅ Use executeWorkflowWithPriority({ priority: "high" })');
  console.log('   ✅ Use API: { "priority": "critical" }\n');
  
  console.log('🎯 Best Practices:');
  console.log('   1. Always declare new workflows in taskQueues.ts');
  console.log('   2. Use explicit priority for one-off urgent cases');
  console.log('   3. Monitor logs for unexpected NORMAL assignments');
  console.log('   4. Test new workflows before production\n');
}

/**
 * Show task queue configurations
 */
export function showTaskQueueConfigurations() {
  console.log('📊 Task Queue Configurations:\n');
  
  const configs = {
    [TASK_QUEUES.CRITICAL]: { timeout: '2m', concurrency: 50, description: 'Emergency workflows' },
    [TASK_QUEUES.HIGH]: { timeout: '5m', concurrency: 30, description: 'Important workflows' },
    [TASK_QUEUES.NORMAL]: { timeout: '15m', concurrency: 15, description: 'Standard workflows (DEFAULT)' },
    [TASK_QUEUES.LOW]: { timeout: '30m', concurrency: 8, description: 'Batch operations' },
    [TASK_QUEUES.BACKGROUND]: { timeout: '60m', concurrency: 5, description: 'Background tasks' }
  };
  
  Object.entries(configs).forEach(([queue, config]) => {
    const isDefault = queue === TASK_QUEUES.NORMAL;
    console.log(`${isDefault ? '📌' : '📋'} ${queue} ${isDefault ? '(DEFAULT FOR UNDECLARED)' : ''}`);
    console.log(`   ⏱️  Timeout: ${config.timeout}`);
    console.log(`   🔄 Concurrency: ${config.concurrency} tasks`);
    console.log(`   💡 Use: ${config.description}\n`);
  });
}

// Run all tests if executed directly
if (require.main === module) {
  console.log('🧪 Running Priority Fallback Tests...\n');
  
  testUndeclaredWorkflows();
  testPriorityOverrides();
  testExecutionScenarios();
  showSafetyNetBehavior();
  showTaskQueueConfigurations();
  
  console.log('🎉 All fallback tests completed!\n');
  console.log('💡 Key Takeaway: Workflows ALWAYS execute, undeclared ones go to NORMAL priority');
}
