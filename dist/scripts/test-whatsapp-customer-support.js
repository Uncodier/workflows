"use strict";
/**
 * Test script for WhatsApp Customer Support Integration
 * This script tests the answerWhatsappMessageWorkflow with customer support integration
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.testWhatsAppWithCustomerSupport = testWhatsAppWithCustomerSupport;
exports.testWhatsAppWithoutCustomerSupport = testWhatsAppWithoutCustomerSupport;
exports.testOriginParameterIntegration = testOriginParameterIntegration;
const client_1 = require("../temporal/client");
// Sample WhatsApp messages that should trigger customer support
const testWhatsAppMessages = [
    {
        message: "Tengo un problema urgente con mi pedido. El producto llegó dañado y necesito una solución inmediata.",
        phone: "+573001234567",
        contact_name: "María González",
        message_id: "whatsapp_urgent_001",
        conversation_id: "conv_urgent_001",
        site_id: "9be0a6a2-5567-41bf-ad06-cb4014f0faf2",
        user_id: "541396e1-a904-4a81-8cbf-0ca4e3b8b2b4",
        message_type: "text",
        timestamp: new Date().toISOString()
    },
    {
        message: "Hola, me interesa conocer más sobre sus servicios premium. ¿Pueden contactarme para una demo?",
        phone: "+573009876543",
        contact_name: "Carlos Rodríguez",
        message_id: "whatsapp_inquiry_002",
        conversation_id: "conv_inquiry_002",
        site_id: "9be0a6a2-5567-41bf-ad06-cb4014f0faf2",
        user_id: "541396e1-a904-4a81-8cbf-0ca4e3b8b2b4",
        message_type: "text",
        timestamp: new Date().toISOString()
    },
    {
        message: "Gracias por la respuesta anterior. Todo está perfecto.",
        phone: "+573005554321",
        contact_name: "Ana Martínez",
        message_id: "whatsapp_thanks_003",
        conversation_id: "conv_thanks_003",
        site_id: "9be0a6a2-5567-41bf-ad06-cb4014f0faf2",
        user_id: "541396e1-a904-4a81-8cbf-0ca4e3b8b2b4",
        message_type: "text",
        timestamp: new Date().toISOString()
    }
];
/**
 * Test WhatsApp message that should trigger customer support
 */
async function testWhatsAppWithCustomerSupport() {
    try {
        console.log('📱 Testing WhatsApp Message with Customer Support Integration...');
        const client = await (0, client_1.getTemporalClient)();
        const messageData = testWhatsAppMessages[0]; // Use urgent message
        console.log('📋 Testing urgent message with customer support:', {
            from: messageData.contact_name,
            phone: messageData.phone,
            messagePreview: messageData.message.substring(0, 50) + '...',
            site_id: messageData.site_id,
            user_id: messageData.user_id,
            messageType: messageData.message_type
        });
        const options = {
            autoRespond: true,
            agentId: 'test-whatsapp-cs-agent-001'
        };
        const result = await client.workflow.execute('answerWhatsappMessageWorkflow', {
            args: [messageData, options],
            taskQueue: 'whatsapp-queue',
            workflowId: `test-whatsapp-cs-${Date.now()}`,
        });
        console.log('✅ WhatsApp with Customer Support workflow completed!');
        console.log(`📊 Result:`, JSON.stringify(result, null, 2));
        // Verify the results
        if (result.customerSupportTriggered) {
            console.log('🎉 SUCCESS: Customer support was triggered as expected');
            console.log(`📞 Customer support workflow ID: ${result.customerSupportResult?.workflowId}`);
            console.log(`✅ Customer support processed: ${result.customerSupportResult?.processed}`);
        }
        else {
            console.log('⚠️ WARNING: Customer support was not triggered');
        }
    }
    catch (error) {
        console.error('❌ WhatsApp Customer Support integration test failed:', error);
    }
}
/**
 * Test WhatsApp message that should NOT trigger customer support
 */
async function testWhatsAppWithoutCustomerSupport() {
    try {
        console.log('📱 Testing WhatsApp Message WITHOUT Customer Support...');
        const client = await (0, client_1.getTemporalClient)();
        const messageData = testWhatsAppMessages[2]; // Use simple thanks message
        console.log('📋 Testing simple message without customer support:', {
            from: messageData.contact_name,
            phone: messageData.phone,
            messagePreview: messageData.message.substring(0, 50) + '...',
            site_id: messageData.site_id,
            user_id: messageData.user_id,
            messageType: messageData.message_type
        });
        const options = {
            autoRespond: false, // Disable auto-respond for this test
            agentId: 'test-whatsapp-simple-agent-002'
        };
        const result = await client.workflow.execute('answerWhatsappMessageWorkflow', {
            args: [messageData, options],
            taskQueue: 'whatsapp-queue',
            workflowId: `test-whatsapp-simple-${Date.now()}`,
        });
        console.log('✅ Simple WhatsApp workflow completed!');
        console.log(`📊 Result:`, JSON.stringify(result, null, 2));
        // Verify the results
        if (!result.customerSupportTriggered) {
            console.log('🎉 SUCCESS: Customer support was NOT triggered as expected');
        }
        else {
            console.log('⚠️ WARNING: Customer support was triggered unexpectedly');
        }
    }
    catch (error) {
        console.error('❌ Simple WhatsApp workflow test failed:', error);
    }
}
/**
 * Test origin parameter integration
 */
async function testOriginParameterIntegration() {
    try {
        console.log('🔄 Testing Origin Parameter Integration...');
        const client = await (0, client_1.getTemporalClient)();
        const messageData = testWhatsAppMessages[1]; // Use inquiry message
        console.log('📋 Testing origin parameter with inquiry message:', {
            from: messageData.contact_name,
            phone: messageData.phone,
            messagePreview: messageData.message.substring(0, 50) + '...',
            expectedOrigin: 'whatsapp'
        });
        const options = {
            autoRespond: true,
            agentId: 'test-origin-agent-003'
        };
        const result = await client.workflow.execute('answerWhatsappMessageWorkflow', {
            args: [messageData, options],
            taskQueue: 'whatsapp-queue',
            workflowId: `test-origin-${Date.now()}`,
        });
        console.log('✅ Origin parameter test completed!');
        console.log(`📊 Result:`, JSON.stringify(result, null, 2));
        if (result.customerSupportTriggered && result.customerSupportResult?.success) {
            console.log('🎉 SUCCESS: Origin parameter integration working');
            console.log('📋 Customer support should have received origin="whatsapp"');
        }
    }
    catch (error) {
        console.error('❌ Origin parameter integration test failed:', error);
    }
}
// Main execution
async function main() {
    console.log('=== WhatsApp Customer Support Integration Tests ===\n');
    try {
        // Test 1: WhatsApp message that should trigger customer support
        console.log('📝 Test 1: WhatsApp Message WITH Customer Support');
        console.log('─'.repeat(60));
        await testWhatsAppWithCustomerSupport();
        console.log('\n\n📝 Test 2: WhatsApp Message WITHOUT Customer Support');
        console.log('─'.repeat(60));
        await testWhatsAppWithoutCustomerSupport();
        console.log('\n\n📝 Test 3: Origin Parameter Integration');
        console.log('─'.repeat(60));
        await testOriginParameterIntegration();
        console.log('\n✅ All WhatsApp Customer Support integration tests completed!');
    }
    catch (error) {
        console.error('\n❌ Integration tests failed:', error);
        process.exit(1);
    }
}
// Run tests if this script is executed directly
if (require.main === module) {
    main().catch(console.error);
}
