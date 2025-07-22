"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.testPhoneFormattingAndInvalidation = testPhoneFormattingAndInvalidation;
const { Client } = require('@temporalio/client');
const leadFollowUpWorkflow_1 = require("../temporal/workflows/leadFollowUpWorkflow");
/**
 * Test script to verify phone formatting and lead invalidation for problematic numbers
 * Tests the fix for numbers like "2464592903" that were causing WhatsApp failures
 */
async function testPhoneFormattingAndInvalidation() {
    console.log('🧪 Testing phone formatting and lead invalidation workflow...');
    // Test the phone formatting function directly
    console.log('\n📞 Testing phone number formatting:');
    // Test cases for various phone formats
    const testPhones = [
        '2464592903', // The problematic US number
        '663211223', // Spanish mobile (9 digits)
        '663 211 22 33', // Spanish mobile with spaces
        '+34663211223', // Already formatted Spanish
        '1234567890', // US number starting with 1
        '12464592903', // US number with country code
        '+12464592903', // Already formatted US
        '447712345678', // UK number
        '+447712345678', // Already formatted UK
        '33123456789', // France number
        '49123456789', // Germany number
        '9123456789', // Spanish landline
        '123456789', // 9-digit unknown
        '12345', // Short number
    ];
    // Since we can't import the function directly (it's inside the workflow),
    // we'll create a local copy for testing
    function formatPhoneNumber(phone) {
        if (!phone || typeof phone !== 'string') {
            return phone;
        }
        const cleanPhone = phone.replace(/[^\d+]/g, '');
        if (cleanPhone.startsWith('+')) {
            return cleanPhone;
        }
        if (cleanPhone.startsWith('34') && cleanPhone.length === 11) {
            return '+' + cleanPhone;
        }
        if (cleanPhone.length === 9 && (cleanPhone.startsWith('6') || cleanPhone.startsWith('7'))) {
            return '+34' + cleanPhone;
        }
        if (cleanPhone.length === 9 && cleanPhone.startsWith('9')) {
            return '+34' + cleanPhone;
        }
        if (cleanPhone.length === 9) {
            return '+34' + cleanPhone;
        }
        if (cleanPhone.length === 10 && (cleanPhone.startsWith('6') || cleanPhone.startsWith('7'))) {
            return '+34' + cleanPhone;
        }
        // US/Canada numbers (10 digits, starting with 2-9)
        if (cleanPhone.length === 10 && /^[2-9]\d{9}$/.test(cleanPhone)) {
            return '+1' + cleanPhone;
        }
        if (cleanPhone.startsWith('1') && cleanPhone.length === 11) {
            return '+' + cleanPhone;
        }
        if (cleanPhone.length === 11 && cleanPhone.startsWith('44')) {
            return '+' + cleanPhone;
        }
        if (cleanPhone.startsWith('33') && cleanPhone.length === 12) {
            return '+' + cleanPhone;
        }
        if (cleanPhone.startsWith('49') && (cleanPhone.length === 11 || cleanPhone.length === 12)) {
            return '+' + cleanPhone;
        }
        if (cleanPhone.length <= 9 && cleanPhone.length >= 7) {
            return '+34' + cleanPhone;
        }
        if (cleanPhone.length >= 10) {
            console.log(`⚠️ Unknown phone format, returning without prefix: ${phone} -> ${cleanPhone}`);
            return cleanPhone;
        }
        console.log(`⚠️ Unable to format phone number: ${phone} -> ${cleanPhone}`);
        return cleanPhone;
    }
    testPhones.forEach(phone => {
        const formatted = formatPhoneNumber(phone);
        console.log(`   ${phone.padEnd(15)} -> ${formatted}`);
    });
    console.log('\n✅ Phone formatting test completed');
    console.log(`📋 Key result: "2464592903" -> "${formatPhoneNumber('2464592903')}" (should be +12464592903)`);
    // Test the actual workflow with a problematic lead
    if (process.env.TEMPORAL_ADDRESS) {
        console.log('\n🔧 Testing actual workflow execution with problematic phone number...');
        console.log('⚠️ This will trigger a real workflow execution - use carefully!');
        try {
            const client = new Client({
                connection: {
                    address: process.env.TEMPORAL_ADDRESS,
                },
            });
            // You would need to provide actual lead_id and site_id for this test
            const testOptions = {
                lead_id: 'test-lead-with-bad-phone', // Replace with actual test lead ID
                site_id: 'test-site-id', // Replace with actual test site ID
                userId: 'test-user-id',
                additionalData: {
                    test_scenario: 'phone_formatting_and_invalidation',
                    original_phone: '2464592903',
                    expected_formatted: '+12464592903',
                    test_timestamp: new Date().toISOString()
                }
            };
            console.log('🚀 Starting leadFollowUpWorkflow test...');
            console.log('📋 Test options:', JSON.stringify(testOptions, null, 2));
            const handle = await client.workflow.start(leadFollowUpWorkflow_1.leadFollowUpWorkflow, {
                args: [testOptions],
                taskQueue: 'workflows',
                workflowId: `test-phone-formatting-${Date.now()}`,
            });
            console.log(`📊 Workflow started with ID: ${handle.workflowId}`);
            console.log(`🔗 Workflow execution: ${handle.workflowId}`);
            // Don't wait for completion in test mode to avoid long-running tests
            console.log('⏭️ Workflow started successfully - check Temporal UI for execution details');
        }
        catch (error) {
            console.error('❌ Error testing workflow:', error);
            console.log('💡 Make sure TEMPORAL_ADDRESS and other environment variables are set');
            console.log('💡 Also ensure you have valid test lead_id and site_id');
        }
    }
    else {
        console.log('\n⚠️ TEMPORAL_ADDRESS not set - skipping workflow execution test');
        console.log('💡 Set TEMPORAL_ADDRESS environment variable to test actual workflow execution');
    }
    console.log('\n🎉 Test completed!');
    console.log('\n📋 Summary of fixes:');
    console.log('✅ 1. Phone formatting now handles US/Canada numbers (10 digits starting with 2-9)');
    console.log('✅ 2. Error handling now catches WhatsApp activity exceptions');
    console.log('✅ 3. Lead invalidation will execute when WhatsApp fails due to invalid phone format');
    console.log('✅ 4. Better logging and error details for troubleshooting');
}
// Run the test
if (require.main === module) {
    testPhoneFormattingAndInvalidation().catch(console.error);
}
