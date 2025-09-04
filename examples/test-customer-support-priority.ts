/**
 * Test Script: Customer Support High Priority
 * 
 * This script demonstrates that customerSupportWorkflow now runs with HIGH priority
 * instead of CRITICAL priority.
 */

import { getTaskQueueForWorkflow, TASK_QUEUES } from '../src/temporal/config/taskQueues';
import { executeHighPriorityCustomerSupport } from './priority-workflow-examples';
import type { EmailData } from '../src/temporal/activities/customerSupportActivities';

/**
 * Test that customerSupportWorkflow gets HIGH priority assignment
 */
export function testCustomerSupportPriority() {
  console.log('🧪 Testing Customer Support Priority Assignment...');
  
  // Test automatic priority assignment
  const assignedTaskQueue = getTaskQueueForWorkflow('customerSupportMessageWorkflow');
  
  console.log(`📋 Test Results:`);
  console.log(`   - Workflow Type: customerSupportMessageWorkflow`);
  console.log(`   - Assigned Task Queue: ${assignedTaskQueue}`);
  console.log(`   - Expected: ${TASK_QUEUES.HIGH}`);
  console.log(`   - Match: ${assignedTaskQueue === TASK_QUEUES.HIGH ? '✅ PASS' : '❌ FAIL'}`);
  
  // Test with explicit priority override
  const overrideTaskQueue = getTaskQueueForWorkflow('customerSupportMessageWorkflow', 'critical');
  console.log(`\n🔄 Testing priority override:`);
  console.log(`   - Override Priority: critical`);
  console.log(`   - Assigned Task Queue: ${overrideTaskQueue}`);
  console.log(`   - Expected: ${TASK_QUEUES.CRITICAL}`);
  console.log(`   - Match: ${overrideTaskQueue === TASK_QUEUES.CRITICAL ? '✅ PASS' : '❌ FAIL'}`);
  
  return {
    automaticAssignment: assignedTaskQueue === TASK_QUEUES.HIGH,
    priorityOverride: overrideTaskQueue === TASK_QUEUES.CRITICAL,
    assignedQueue: assignedTaskQueue
  };
}

/**
 * Example usage of the updated customer support workflow
 */
export async function demonstrateHighPriorityCustomerSupport() {
  console.log('\n🚀 Demonstrating High Priority Customer Support Execution...');
  
  // Mock email data for demonstration
  const mockEmailData: EmailData = {
    summary: 'Customer inquiry about billing issue',
    original_subject: 'Billing Question - Account #12345',
    contact_info: {
      name: 'John Doe',
      email: 'john.doe@example.com',
      phone: '+1-555-0123',
      company: 'Example Corp'
    },
    site_id: 'site-123',
    user_id: 'user-456',
    lead_notification: 'none',
    analysis_id: 'analysis-789',
    priority: 'medium',
    intent: 'inquiry',
    potential_value: 'medium'
  };
  
  console.log('📧 Mock Email Data:');
  console.log(`   - Subject: ${mockEmailData.original_subject}`);
  console.log(`   - From: ${mockEmailData.contact_info.name} <${mockEmailData.contact_info.email}>`);
  console.log(`   - Priority: HIGH (automatically assigned)`);
  
  try {
    // This would execute the workflow with HIGH priority
    // Commented out to avoid actual execution in test
    // const result = await executeHighPriorityCustomerSupport(mockEmailData);
    
    console.log('\n✅ Would execute with HIGH priority configuration:');
    console.log(`   - Task Queue: ${TASK_QUEUES.HIGH}`);
    console.log(`   - Timeout: 5 minutes`);
    console.log(`   - Concurrency: 30 concurrent tasks`);
    console.log(`   - Priority Level: High (not Critical)`);
    
    return {
      success: true,
      taskQueue: TASK_QUEUES.HIGH,
      priority: 'high',
      message: 'Customer support workflow configured for HIGH priority execution'
    };
    
  } catch (error) {
    console.error('❌ Demo failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Compare OLD vs NEW priority configuration
 */
export function comparePriorityConfiguration() {
  console.log('\n📊 Priority Configuration Comparison:');
  console.log('');
  console.log('BEFORE (Critical Priority):');
  console.log('  🚨 Task Queue: critical-priority');
  console.log('  ⏱️  Timeout: 2 minutes');
  console.log('  🔄 Concurrency: 50 tasks');
  console.log('  💡 Use Case: Emergency situations only');
  console.log('');
  console.log('AFTER (High Priority):');
  console.log('  ⚡ Task Queue: high-priority');
  console.log('  ⏱️  Timeout: 5 minutes');
  console.log('  🔄 Concurrency: 30 tasks');
  console.log('  💡 Use Case: Important customer-facing workflows');
  console.log('');
  console.log('✅ Benefits of the change:');
  console.log('  • Critical queue reserved for true emergencies');
  console.log('  • Customer support gets appropriate priority');
  console.log('  • More reasonable timeout (5m vs 2m)');
  console.log('  • Better resource allocation');
}

// Run tests if this file is executed directly
if (require.main === module) {
  console.log('🧪 Running Customer Support Priority Tests...\n');
  
  const testResults = testCustomerSupportPriority();
  
  console.log('\n📝 Test Summary:');
  console.log(`  • Automatic Assignment: ${testResults.automaticAssignment ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`  • Priority Override: ${testResults.priorityOverride ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`  • Assigned Queue: ${testResults.assignedQueue}`);
  
  demonstrateHighPriorityCustomerSupport();
  comparePriorityConfiguration();
  
  console.log('\n🎉 All tests completed!');
}
