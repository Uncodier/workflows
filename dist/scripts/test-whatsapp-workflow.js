"use strict";
/**
 * Manual test script for WhatsApp Message Workflow
 * This script can be run to test the answerWhatsappMessageWorkflow functionality
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.testSingleWhatsAppMessage = testSingleWhatsAppMessage;
exports.testWhatsAppAnalysisOnly = testWhatsAppAnalysisOnly;
exports.testBatchWhatsAppMessages = testBatchWhatsAppMessages;
const client_1 = require("../temporal/client");
// Sample WhatsApp message data for testing
const testWhatsAppMessages = [
    {
        messageContent: "Hola, me interesa conocer más sobre sus servicios. ¿Podrían proporcionarme información sobre precios y planes?",
        phoneNumber: "+573001234567",
        senderName: "María González",
        messageId: "whatsapp_msg_001",
        conversationId: "conv_001",
        siteId: "9be0a6a2-5567-41bf-ad06-cb4014f0faf2",
        userId: "541396e1-a904-4a81-8cbf-0ca4e3b8b2b4",
        message_type: "text",
        timestamp: new Date().toISOString()
    },
    {
        messageContent: "Tengo un problema con mi pedido. El producto llegó dañado y necesito hacer una devolución urgente.",
        phoneNumber: "+573009876543",
        senderName: "Carlos Rodríguez",
        messageId: "whatsapp_msg_002",
        conversationId: "conv_002",
        siteId: "9be0a6a2-5567-41bf-ad06-cb4014f0faf2",
        userId: "541396e1-a904-4a81-8cbf-0ca4e3b8b2b4",
        message_type: "text",
        timestamp: new Date().toISOString()
    },
    {
        messageContent: "Buen día! Quería saber si tienen disponibilidad para una cita esta semana.",
        phoneNumber: "+573005554321",
        senderName: "Ana Martínez",
        messageId: "whatsapp_msg_003",
        conversationId: "conv_003",
        siteId: "9be0a6a2-5567-41bf-ad06-cb4014f0faf2",
        userId: "541396e1-a904-4a81-8cbf-0ca4e3b8b2b4",
        message_type: "text",
        timestamp: new Date().toISOString()
    }
];
/**
 * Test single WhatsApp message analysis workflow
 */
async function testSingleWhatsAppMessage() {
    try {
        console.log('📱 Testing Single WhatsApp Message Analysis...');
        const client = await (0, client_1.getTemporalClient)();
        const messageData = testWhatsAppMessages[0]; // Use first message
        console.log('📋 Testing message analysis with:', {
            from: messageData.senderName,
            phone: messageData.phoneNumber,
            messagePreview: messageData.messageContent.substring(0, 50) + '...',
            site_id: messageData.siteId,
            user_id: messageData.userId,
            messageType: messageData.message_type
        });
        const options = {
            autoRespond: true,
            agentId: 'test-whatsapp-agent-001'
        };
        const result = await client.workflow.execute('answerWhatsappMessageWorkflow', {
            args: [messageData, options],
            taskQueue: 'whatsapp-queue',
            workflowId: `test-single-whatsapp-${Date.now()}`,
        });
        console.log('✅ Single WhatsApp workflow completed!');
        console.log(`📊 Result:`, JSON.stringify(result, null, 2));
    }
    catch (error) {
        console.error('❌ Single WhatsApp workflow test failed:', error);
    }
}
/**
 * Test WhatsApp message analysis only (no auto-response)
 */
async function testWhatsAppAnalysisOnly() {
    try {
        console.log('🔍 Testing WhatsApp Message Analysis Only...');
        const client = await (0, client_1.getTemporalClient)();
        const messageData = testWhatsAppMessages[1]; // Use second message (complaint)
        console.log('📋 Testing analysis-only with:', {
            from: messageData.senderName,
            phone: messageData.phoneNumber,
            messagePreview: messageData.messageContent.substring(0, 50) + '...',
            expectedIntent: 'complaint (high priority)'
        });
        const options = {
            autoRespond: false, // Only analyze, don't respond
            agentId: 'test-whatsapp-agent-002'
        };
        const result = await client.workflow.execute('answerWhatsappMessageWorkflow', {
            args: [messageData, options],
            taskQueue: 'whatsapp-queue',
            workflowId: `test-analysis-only-whatsapp-${Date.now()}`,
        });
        console.log('✅ Analysis-only WhatsApp workflow completed!');
        console.log(`📊 Analysis Result:`, {
            analyzed: result.analyzed,
            responded: result.responded,
            intent: result.analysis?.intent,
            priority: result.analysis?.priority,
            sentiment: result.analysis?.sentiment,
            response_type: result.analysis?.response_type,
            requires_action: result.analysis?.requires_action
        });
    }
    catch (error) {
        console.error('❌ Analysis-only WhatsApp workflow test failed:', error);
    }
}
/**
 * Test batch WhatsApp messages workflow
 */
async function testBatchWhatsAppMessages() {
    try {
        console.log('📱 Testing Batch WhatsApp Messages Workflow...');
        const client = await (0, client_1.getTemporalClient)();
        console.log(`📨 Testing with ${testWhatsAppMessages.length} WhatsApp messages`);
        console.log('📋 Messages overview:', testWhatsAppMessages.map((msg, i) => ({
            index: i + 1,
            from: msg.senderName,
            phone: msg.phoneNumber,
            preview: msg.messageContent.substring(0, 30) + '...'
        })));
        const options = {
            autoRespond: true,
            agentId: 'test-batch-whatsapp-agent',
            intervalMinutes: 0.1 // 6 seconds for testing
        };
        const result = await client.workflow.execute('processWhatsAppMessagesWorkflow', {
            args: [testWhatsAppMessages, options],
            taskQueue: 'whatsapp-queue',
            workflowId: `test-batch-whatsapp-${Date.now()}`,
        });
        console.log('✅ Batch WhatsApp workflow completed!');
        console.log(`📊 Batch Results:`, {
            totalMessages: result.totalMessages,
            processed: result.processed,
            analyzed: result.analyzed,
            responded: result.responded,
            failed: result.failed,
            executionTime: result.executionTime
        });
        console.log('📋 Individual Results:', result.results.map((r) => ({
            phone: r.phone,
            success: r.success,
            analyzed: r.analyzed,
            responded: r.responded,
            error: r.error
        })));
    }
    catch (error) {
        console.error('❌ Batch WhatsApp workflow test failed:', error);
    }
}
// Main execution
async function main() {
    console.log('=== WhatsApp Message Workflow Tests ===\n');
    try {
        // Test 1: Single message with auto-response
        console.log('📝 Test 1: Single WhatsApp Message with Auto-Response');
        console.log('─'.repeat(60));
        await testSingleWhatsAppMessage();
        console.log('\n\n📝 Test 2: WhatsApp Message Analysis Only');
        console.log('─'.repeat(60));
        await testWhatsAppAnalysisOnly();
        console.log('\n\n📝 Test 3: Batch WhatsApp Messages Processing');
        console.log('─'.repeat(60));
        await testBatchWhatsAppMessages();
        console.log('\n✅ All WhatsApp workflow tests completed successfully!');
    }
    catch (error) {
        console.error('\n❌ WhatsApp workflow tests failed:', error);
        process.exit(1);
    }
}
// Run tests if this file is executed directly
if (require.main === module) {
    main().catch(console.error);
}
