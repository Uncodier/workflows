#!/usr/bin/env ts-node
"use strict";
/**
 * Test script para verificar que agentId se maneja correctamente
 * - Se omite cuando es undefined
 * - Se incluye cuando tiene valor
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.testAgentIdBehavior = testAgentIdBehavior;
const customerSupportActivities_1 = require("../temporal/activities/customerSupportActivities");
async function testAgentIdBehavior() {
    console.log('🧪 Testing agentId behavior in customer support activity...\n');
    // Mock data for testing
    const testMessageData = {
        message: "Test message for agentId behavior",
        site_id: "test-site-123",
        user_id: "test-user-456",
        visitor_id: "test-visitor-789",
        name: "Test User",
        email: "test@example.com",
        phone: "+1234567890",
        lead_id: "test-lead-id-123"
    };
    console.log('='.repeat(60));
    console.log('TEST 1: agentId is undefined (should be omitted)');
    console.log('='.repeat(60));
    try {
        // Test with undefined agentId
        const result1 = await (0, customerSupportActivities_1.sendCustomerSupportMessageActivity)(testMessageData, {
            agentId: undefined, // ✅ Should be omitted from request
            origin: 'test'
        });
        console.log('Result 1:', result1.success ? 'SUCCESS' : 'FAILED');
        if (!result1.success) {
            console.log('Error:', result1.error);
        }
    }
    catch (error) {
        console.log('Test 1 Error (expected for testing):', error instanceof Error ? error.message : String(error));
    }
    console.log('\n' + '='.repeat(60));
    console.log('TEST 2: agentId has explicit value (should be included)');
    console.log('='.repeat(60));
    try {
        // Test with explicit agentId
        const result2 = await (0, customerSupportActivities_1.sendCustomerSupportMessageActivity)(testMessageData, {
            agentId: 'custom_support_agent', // ✅ Should be included in request
            origin: 'test'
        });
        console.log('Result 2:', result2.success ? 'SUCCESS' : 'FAILED');
        if (!result2.success) {
            console.log('Error:', result2.error);
        }
    }
    catch (error) {
        console.log('Test 2 Error (expected for testing):', error instanceof Error ? error.message : String(error));
    }
    console.log('\n' + '='.repeat(60));
    console.log('TEST 3: agentId is empty string (should be omitted)');
    console.log('='.repeat(60));
    try {
        // Test with empty string agentId
        const result3 = await (0, customerSupportActivities_1.sendCustomerSupportMessageActivity)(testMessageData, {
            agentId: '', // ✅ Should be omitted from request (falsy value)
            origin: 'test'
        });
        console.log('Result 3:', result3.success ? 'SUCCESS' : 'FAILED');
        if (!result3.success) {
            console.log('Error:', result3.error);
        }
    }
    catch (error) {
        console.log('Test 3 Error (expected for testing):', error instanceof Error ? error.message : String(error));
    }
    console.log('\n🏁 agentId behavior tests completed');
    console.log('\n📋 Expected behavior:');
    console.log('   ✅ Test 1: agentId field should be omitted from payload');
    console.log('   ✅ Test 2: agentId field should be included with value "custom_support_agent"');
    console.log('   ✅ Test 3: agentId field should be omitted from payload (empty string is falsy)');
    console.log('\n💡 Check the logs above to verify the payload structure is correct.');
}
// Run test if called directly
if (require.main === module) {
    testAgentIdBehavior().catch(error => {
        console.error('💥 Test script failed:', error);
        process.exit(1);
    });
}
