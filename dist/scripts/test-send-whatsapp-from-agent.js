"use strict";
/**
 * Test script for Send WhatsApp From Agent Workflow
 * This script tests the sendWhatsappFromAgent workflow functionality
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.testSingleWhatsAppMessage = testSingleWhatsAppMessage;
exports.testMinimalWhatsAppMessage = testMinimalWhatsAppMessage;
exports.testWhatsAppValidation = testWhatsAppValidation;
exports.testBatchWhatsAppMessages = testBatchWhatsAppMessages;
const client_1 = require("../temporal/client");
// Sample WhatsApp message data for testing
const testWhatsAppData = [
    {
        phone_number: "+573001234567",
        message: "Hola María! Gracias por tu interés en nuestros servicios. Un miembro de nuestro equipo se pondrá en contacto contigo pronto.",
        site_id: "9be0a6a2-5567-41bf-ad06-cb4014f0faf2",
        from: "Support Team",
        agent_id: "test-whatsapp-agent-001",
        conversation_id: "conv_test_001",
        lead_id: "lead_test_001"
    },
    {
        phone_number: "+573009876543",
        message: "Estimado Carlos, hemos recibido tu reporte sobre el producto dañado. Nuestro equipo de soporte está revisando tu caso y te contactaremos dentro de las próximas 24 horas.",
        site_id: "9be0a6a2-5567-41bf-ad06-cb4014f0faf2",
        from: "Customer Support",
        agent_id: "test-whatsapp-agent-002",
        conversation_id: "conv_support_002",
        lead_id: "lead_support_002"
    },
    {
        phone_number: "+573005554321",
        message: "¡Hola Ana! Te confirmamos que tu cita ha sido programada para esta semana. Te enviaremos más detalles por correo electrónico.",
        site_id: "9be0a6a2-5567-41bf-ad06-cb4014f0faf2",
        from: "AI Assistant",
        agent_id: "test-whatsapp-agent-003"
    }
];
/**
 * Test sending a single WhatsApp message
 */
async function testSingleWhatsAppMessage() {
    try {
        console.log('📱 Testing Single WhatsApp Message from Agent...');
        const client = await (0, client_1.getTemporalClient)();
        const messageData = testWhatsAppData[0]; // Use first message
        console.log('📋 Testing WhatsApp message with:', {
            recipient: messageData.phone_number,
            from: messageData.from,
            messagePreview: messageData.message.substring(0, 50) + '...',
            site_id: messageData.site_id,
            agent_id: messageData.agent_id,
            conversation_id: messageData.conversation_id,
            lead_id: messageData.lead_id
        });
        const result = await client.workflow.execute('sendWhatsappFromAgent', {
            args: [messageData],
            taskQueue: 'default',
            workflowId: `test-send-whatsapp-${Date.now()}`,
        });
        console.log('✅ Send WhatsApp workflow completed!');
        console.log(`📊 Result:`, JSON.stringify(result, null, 2));
        return result;
    }
    catch (error) {
        console.error('❌ Send WhatsApp workflow test failed:', error);
        throw error;
    }
}
/**
 * Test sending WhatsApp with minimal parameters
 */
async function testMinimalWhatsAppMessage() {
    try {
        console.log('📱 Testing Minimal WhatsApp Message...');
        const client = await (0, client_1.getTemporalClient)();
        const minimalMessage = {
            phone_number: "+573001112222",
            message: "Mensaje de prueba con parámetros mínimos requeridos.",
            site_id: "9be0a6a2-5567-41bf-ad06-cb4014f0faf2"
        };
        console.log('📋 Testing minimal message with:', {
            recipient: minimalMessage.phone_number,
            messagePreview: minimalMessage.message.substring(0, 50) + '...',
            site_id: minimalMessage.site_id
        });
        const result = await client.workflow.execute('sendWhatsappFromAgent', {
            args: [minimalMessage],
            taskQueue: 'default',
            workflowId: `test-minimal-whatsapp-${Date.now()}`,
        });
        console.log('✅ Minimal WhatsApp workflow completed!');
        console.log(`📊 Result:`, JSON.stringify(result, null, 2));
        return result;
    }
    catch (error) {
        console.error('❌ Minimal WhatsApp workflow test failed:', error);
        throw error;
    }
}
/**
 * Test WhatsApp validation with missing parameters
 */
async function testWhatsAppValidation() {
    try {
        console.log('📱 Testing WhatsApp Validation...');
        const client = await (0, client_1.getTemporalClient)();
        const invalidMessage = {
            // Missing phone_number (required)
            message: "Este mensaje debería fallar por falta de phone_number",
            site_id: "9be0a6a2-5567-41bf-ad06-cb4014f0faf2"
        };
        console.log('📋 Testing validation with invalid message (missing phone_number)');
        try {
            await client.workflow.execute('sendWhatsappFromAgent', {
                args: [invalidMessage],
                taskQueue: 'default',
                workflowId: `test-validation-whatsapp-${Date.now()}`,
            });
            console.log('⚠️ WARNING: Validation test should have failed but didn\'t');
        }
        catch (validationError) {
            console.log('✅ SUCCESS: Validation failed as expected');
            console.log('📋 Validation error:', validationError instanceof Error ? validationError.message : String(validationError));
        }
    }
    catch (error) {
        console.error('❌ WhatsApp validation test failed:', error);
        throw error;
    }
}
/**
 * Test batch WhatsApp messages
 */
async function testBatchWhatsAppMessages() {
    try {
        console.log('📱 Testing Batch WhatsApp Messages...');
        const client = await (0, client_1.getTemporalClient)();
        console.log(`📋 Testing ${testWhatsAppData.length} WhatsApp messages`);
        const results = [];
        for (let i = 0; i < testWhatsAppData.length; i++) {
            const messageData = testWhatsAppData[i];
            console.log(`📱 Sending WhatsApp ${i + 1}/${testWhatsAppData.length}:`);
            console.log(`  📞 To: ${messageData.phone_number}`);
            console.log(`  👤 From: ${messageData.from || 'AI Assistant'}`);
            console.log(`  💬 Preview: ${messageData.message.substring(0, 40)}...`);
            try {
                const result = await client.workflow.execute('sendWhatsappFromAgent', {
                    args: [messageData],
                    taskQueue: 'default',
                    workflowId: `test-batch-whatsapp-${i}-${Date.now()}`,
                });
                results.push({
                    index: i,
                    success: true,
                    result,
                    phone: messageData.phone_number
                });
                console.log(`  ✅ WhatsApp ${i + 1} sent successfully`);
            }
            catch (error) {
                results.push({
                    index: i,
                    success: false,
                    error: error instanceof Error ? error.message : String(error),
                    phone: messageData.phone_number
                });
                console.log(`  ❌ WhatsApp ${i + 1} failed:`, error instanceof Error ? error.message : String(error));
            }
            // Wait 1 second between messages
            if (i < testWhatsAppData.length - 1) {
                console.log('  ⏰ Waiting 1 second...');
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
        const successful = results.filter(r => r.success).length;
        const failed = results.filter(r => !r.success).length;
        console.log('🎉 Batch WhatsApp test completed!');
        console.log(`📊 Results: ${successful} successful, ${failed} failed`);
        return results;
    }
    catch (error) {
        console.error('❌ Batch WhatsApp test failed:', error);
        throw error;
    }
}
// Main execution
async function main() {
    console.log('=== Send WhatsApp From Agent Workflow Tests ===\n');
    try {
        // Test 1: Single WhatsApp message
        console.log('📝 Test 1: Single WhatsApp Message');
        console.log('─'.repeat(50));
        await testSingleWhatsAppMessage();
        console.log('\n\n📝 Test 2: Minimal WhatsApp Message');
        console.log('─'.repeat(50));
        await testMinimalWhatsAppMessage();
        console.log('\n\n📝 Test 3: WhatsApp Validation');
        console.log('─'.repeat(50));
        await testWhatsAppValidation();
        console.log('\n\n📝 Test 4: Batch WhatsApp Messages');
        console.log('─'.repeat(50));
        await testBatchWhatsAppMessages();
        console.log('\n✅ All send WhatsApp from agent tests completed!');
    }
    catch (error) {
        console.error('\n❌ Tests failed:', error);
        process.exit(1);
    }
}
// Run tests if this script is executed directly
if (require.main === module) {
    main().catch(console.error);
}
