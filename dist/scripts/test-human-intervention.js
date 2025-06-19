"use strict";
/**
 * Test script for the humanInterventionWorkflow
 * This script demonstrates how to use the human intervention workflow
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.testHumanInterventionWorkflow = testHumanInterventionWorkflow;
const { Connection, Client } = require('@temporalio/client');
async function testHumanInterventionWorkflow() {
    const connection = await Connection.connect({ address: 'localhost:7233' });
    const client = new Client({ connection });
    // Test Case 1: Human intervention without origin (just records intervention)
    console.log('🧪 Test Case 1: Human intervention without origin');
    try {
        const result1 = await client.workflow.execute('humanInterventionWorkflow', {
            taskQueue: 'default',
            workflowId: `test-human-intervention-1-${Date.now()}`,
            args: [{
                    conversationId: 'conv-123',
                    message: 'Hi there! I\'m stepping in to help you with this issue.',
                    user_id: 'user-456',
                    agentId: 'agent-789',
                    conversation_title: 'Support Request',
                    lead_id: 'lead-101',
                    site_id: 'site-202'
                }]
        });
        console.log('✅ Test Case 1 completed:', JSON.stringify(result1, null, 2));
    }
    catch (error) {
        console.error('❌ Test Case 1 failed:', error);
    }
    // Test Case 2: Human intervention with email origin
    console.log('\n🧪 Test Case 2: Human intervention with email origin');
    try {
        const result2 = await client.workflow.execute('humanInterventionWorkflow', {
            taskQueue: 'default',
            workflowId: `test-human-intervention-2-${Date.now()}`,
            args: [{
                    conversationId: 'conv-456',
                    message: 'Thank you for reaching out! Let me help you with your question about our product features.',
                    user_id: 'user-789',
                    agentId: 'agent-101',
                    conversation_title: 'Product Inquiry',
                    lead_id: 'lead-303',
                    visitor_id: 'visitor-404',
                    site_id: 'site-505',
                    origin: 'email'
                }]
        });
        console.log('✅ Test Case 2 completed:', JSON.stringify(result2, null, 2));
    }
    catch (error) {
        console.error('❌ Test Case 2 failed:', error);
    }
    // Test Case 3: Human intervention with WhatsApp origin
    console.log('\n🧪 Test Case 3: Human intervention with WhatsApp origin');
    try {
        const result3 = await client.workflow.execute('humanInterventionWorkflow', {
            taskQueue: 'default',
            workflowId: `test-human-intervention-3-${Date.now()}`,
            args: [{
                    conversationId: 'conv-789',
                    message: '¡Hola! Te ayudo con tu consulta sobre nuestros servicios.',
                    user_id: 'user-101',
                    agentId: 'agent-202',
                    conversation_title: 'Consulta de Servicios',
                    lead_id: 'lead-606',
                    site_id: 'site-707',
                    origin: 'whatsapp'
                }]
        });
        console.log('✅ Test Case 3 completed:', JSON.stringify(result3, null, 2));
    }
    catch (error) {
        console.error('❌ Test Case 3 failed:', error);
    }
    // Test Case 4: Minimal required parameters
    console.log('\n🧪 Test Case 4: Minimal required parameters');
    try {
        const result4 = await client.workflow.execute('humanInterventionWorkflow', {
            taskQueue: 'default',
            workflowId: `test-human-intervention-4-${Date.now()}`,
            args: [{
                    conversationId: 'conv-minimal',
                    message: 'Quick intervention message',
                    user_id: 'user-minimal',
                    agentId: 'agent-minimal'
                }]
        });
        console.log('✅ Test Case 4 completed:', JSON.stringify(result4, null, 2));
    }
    catch (error) {
        console.error('❌ Test Case 4 failed:', error);
    }
    await connection.close();
}
// Run the test if this file is executed directly
if (require.main === module) {
    testHumanInterventionWorkflow()
        .then(() => {
        console.log('\n🎉 All tests completed!');
        process.exit(0);
    })
        .catch((error) => {
        console.error('\n💥 Test execution failed:', error);
        process.exit(1);
    });
}
