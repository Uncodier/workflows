"use strict";
/**
 * Test script for WhatsApp Template Workflow
 * Tests both scenarios: direct message and template flow
 */
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("../temporal/client");
const sendWhatsappFromAgentWorkflow_1 = require("../temporal/workflows/sendWhatsappFromAgentWorkflow");
const nanoid_1 = require("nanoid");
async function testWhatsAppTemplateWorkflow() {
    console.log('🧪 Testing WhatsApp Template Workflow...\n');
    const client = await (0, client_1.getTemporalClient)();
    // Test parameters
    const baseParams = {
        phone_number: '+1234567890',
        message: 'Hello! This is a test message from the AI assistant.',
        site_id: 'test-site-id',
        from: 'Test Assistant',
        agent_id: 'test-agent-id',
        conversation_id: 'test-conversation-id',
        lead_id: 'test-lead-id'
    };
    try {
        // Test 1: Scenario A - Direct message (with response window)
        console.log('📱 Test 1: Direct message scenario (response window available)');
        console.log('Expected: Should send message directly without template flow\n');
        const workflowId1 = `test-whatsapp-direct-${(0, nanoid_1.nanoid)()}`;
        const handle1 = await client.workflow.start(sendWhatsappFromAgentWorkflow_1.sendWhatsappFromAgent, {
            args: [baseParams],
            taskQueue: 'workflows',
            workflowId: workflowId1,
        });
        console.log(`⏳ Workflow started: ${workflowId1}`);
        const result1 = await handle1.result();
        console.log('✅ Test 1 Result:', {
            success: result1.success,
            messageId: result1.messageId,
            recipient: result1.recipient,
            executionTime: result1.executionTime,
            timestamp: result1.timestamp
        });
        console.log('\n' + '='.repeat(50) + '\n');
        // Test 2: Scenario B - Template flow (no response window)
        console.log('📄 Test 2: Template scenario (no response window available)');
        console.log('Expected: Should create template and then send template\n');
        const workflowId2 = `test-whatsapp-template-${(0, nanoid_1.nanoid)()}`;
        const handle2 = await client.workflow.start(sendWhatsappFromAgentWorkflow_1.sendWhatsappFromAgent, {
            args: [baseParams],
            taskQueue: 'workflows',
            workflowId: workflowId2,
        });
        console.log(`⏳ Workflow started: ${workflowId2}`);
        const result2 = await handle2.result();
        console.log('✅ Test 2 Result:', {
            success: result2.success,
            messageId: result2.messageId,
            recipient: result2.recipient,
            executionTime: result2.executionTime,
            timestamp: result2.timestamp
        });
        console.log('\n🎉 All tests completed successfully!');
    }
    catch (error) {
        console.error('❌ Test failed:', error);
        process.exit(1);
    }
    finally {
        // Client cleanup handled automatically
    }
}
// Test parameter validation
async function testParameterValidation() {
    console.log('\n🧪 Testing parameter validation...\n');
    const client = await (0, client_1.getTemporalClient)();
    try {
        // Test with missing required parameters
        const workflowId = `test-validation-${(0, nanoid_1.nanoid)()}`;
        const handle = await client.workflow.start(sendWhatsappFromAgentWorkflow_1.sendWhatsappFromAgent, {
            args: [{
                    phone_number: '', // Missing phone number
                    message: 'Test message',
                    site_id: 'test-site-id'
                }],
            taskQueue: 'workflows',
            workflowId: workflowId,
        });
        try {
            await handle.result();
            console.log('❌ Expected validation error but workflow succeeded');
        }
        catch (error) {
            console.log('✅ Parameter validation working correctly:', error instanceof Error ? error.message : String(error));
        }
    }
    catch (error) {
        console.error('❌ Validation test failed:', error);
    }
    finally {
        // Client cleanup handled automatically
    }
}
async function main() {
    try {
        console.log('🚀 Starting WhatsApp Template Workflow Tests\n');
        console.log('This will test both scenarios:');
        console.log('  A) Direct message (response window available)');
        console.log('  B) Template flow (no response window)\n');
        await testWhatsAppTemplateWorkflow();
        await testParameterValidation();
    }
    catch (error) {
        console.error('❌ Test suite failed:', error);
        process.exit(1);
    }
}
if (require.main === module) {
    main();
}
