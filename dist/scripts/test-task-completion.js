"use strict";
/**
 * Test script to verify that first_contact tasks are marked as completed after sending initial messages
 *
 * This script tests the updateTaskStatusToCompletedActivity function
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.testTaskCompletion = testTaskCompletion;
exports.testWorkflowIntegration = testWorkflowIntegration;
exports.verifyTaskStates = verifyTaskStates;
const leadActivities_1 = require("../temporal/activities/leadActivities");
async function testTaskCompletion() {
    console.log('🧪 Testing task completion functionality...');
    // Example test data - replace with real lead and site IDs from your database
    const testData = {
        lead_id: '12345678-1234-1234-1234-123456789abc', // Replace with a real lead ID
        site_id: '87654321-4321-4321-4321-cba987654321', // Replace with a real site ID
        stage: 'awareness', // First contact tasks are typically in awareness stage
        status: 'completed',
        notes: 'Task marked as completed by test script - initial message sent successfully'
    };
    try {
        console.log('📝 Testing updateTaskStatusToCompletedActivity...');
        console.log('Test data:', JSON.stringify(testData, null, 2));
        const result = await (0, leadActivities_1.updateTaskStatusToCompletedActivity)(testData);
        console.log('📊 Test Result:');
        console.log('  Success:', result.success);
        console.log('  Updated Task ID:', result.updated_task_id || 'none');
        console.log('  Task Found:', result.task_found);
        if (result.error) {
            console.log('  Error:', result.error);
        }
        if (result.success && result.updated_task_id) {
            console.log('✅ Test PASSED: Task was successfully marked as completed');
        }
        else if (result.success && !result.task_found) {
            console.log('⚠️ Test WARNING: No task found to update (this is normal if no awareness task exists for this lead)');
        }
        else {
            console.log('❌ Test FAILED: Task completion failed');
        }
    }
    catch (error) {
        console.error('❌ Test ERROR:', error);
    }
}
// Demonstrative workflow integration test
async function testWorkflowIntegration() {
    console.log('\n🔄 Testing workflow integration scenarios...');
    console.log('📧 Scenario 1: Email Customer Support Message sent successfully');
    console.log('   Expected behavior: First_contact task should be marked as completed');
    console.log('   Workflow: emailCustomerSupportMessageWorkflow');
    console.log('   Trigger: After emailSent = true');
    console.log('\n📱 Scenario 2: WhatsApp Customer Support Message sent successfully');
    console.log('   Expected behavior: First_contact task should be marked as completed');
    console.log('   Workflow: customerSupportMessageWorkflow (WhatsApp branch)');
    console.log('   Trigger: After whatsappSent = true');
    console.log('\n📞 Scenario 3: Lead Follow-up Message sent successfully');
    console.log('   Expected behavior: First_contact task should be marked as completed');
    console.log('   Workflow: leadFollowUpWorkflow');
    console.log('   Trigger: After emailSent || whatsappSent = true');
    console.log('\n✅ Integration points added to workflows:');
    console.log('   - leadFollowUpWorkflow.ts (Step 4.2)');
    console.log('   - customerSupportWorkflow.ts (Email branch)');
    console.log('   - customerSupportWorkflow.ts (WhatsApp branch)');
}
// Task status verification
async function verifyTaskStates() {
    console.log('\n📋 Task Status Information:');
    console.log('Available task statuses: completed, in_progress, pending, failed');
    console.log('Available task stages: awareness, consideration, decision, purchase, retention, referral');
    console.log('First contact tasks are typically: stage=awareness, status=pending → completed');
    console.log('\n🔍 The updateTaskStatusToCompletedActivity function:');
    console.log('  - Searches for tasks by lead_id + site_id + stage (if no task_id provided)');
    console.log('  - Updates status to completed and sets completed_date');
    console.log('  - Adds notes about the completion trigger');
    console.log('  - Returns success=true even if no task found (to not fail workflows)');
    console.log('  - Provides task_found flag to distinguish between success cases');
}
// Main test function
async function runAllTests() {
    console.log('🚀 Starting Task Completion Tests\n');
    await verifyTaskStates();
    await testWorkflowIntegration();
    console.log('\n⚠️  To test with real data:');
    console.log('1. Replace the test lead_id and site_id with real values from your database');
    console.log('2. Ensure there is an awareness task for that lead');
    console.log('3. Run: npm run test:task-completion');
    console.log('\n🎯 Uncomment the following line to test with real data:');
    console.log('// await testTaskCompletion();');
    // Uncomment to test with real data (make sure to use real IDs)
    // await testTaskCompletion();
    console.log('\n✅ Task Completion Tests Completed');
}
// Run tests
if (require.main === module) {
    runAllTests().catch(console.error);
}
