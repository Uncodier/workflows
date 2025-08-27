"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("../temporal/client");
const robotWorkflow_1 = require("../temporal/workflows/robotWorkflow");
/**
 * Test script para verificar el nuevo flujo de guardado de sesión
 * en el robotWorkflow
 */
async function main() {
    console.log('🧪 Testing session save workflow...');
    try {
        // Connect to Temporal
        const client = await (0, client_1.getTemporalClient)();
        console.log('✅ Connected to Temporal');
        // Test parameters - ajustar según sea necesario
        const testParams = {
            site_id: 'test-site-session-save',
            activity: 'test-activity-with-auth',
            instance_id: 'test-instance-' + Date.now(),
            user_id: 'test-user-123'
        };
        console.log(`🚀 Starting robot workflow with session save testing...`);
        console.log(`📋 Parameters:`, testParams);
        const handle = await client.workflow.start(robotWorkflow_1.robotWorkflow, {
            args: [testParams],
            taskQueue: 'default',
            workflowId: `test-session-save-${Date.now()}`,
        });
        console.log(`🔗 Workflow started with ID: ${handle.workflowId}`);
        console.log(`📊 Workflow run ID: ${handle.firstExecutionRunId}`);
        // Opcional: esperar a que termine el workflow (comentar si quieres que corra en background)
        /*
        console.log(`⏳ Waiting for workflow to complete...`);
        const result = await handle.result();
        console.log(`✅ Workflow completed successfully!`);
        console.log(`📊 Final result:`, JSON.stringify(result, null, 2));
        */
        console.log(`🎯 Test workflow started. Monitor the logs to see session save handling.`);
        console.log(`📝 Expected behavior:`);
        console.log(`   1. When authentication step completes with new_session: true`);
        console.log(`   2. Should log "New session acquired" and continue`);
        console.log(`   3. Next step should be session_save type`);
        console.log(`   4. When session_save step completes, should call callRobotAuthActivity`);
        console.log(`   5. Should handle authentication timeout (5 minutes) properly`);
        console.log(`   6. Should trigger human intervention on auth timeout`);
    }
    catch (error) {
        console.error(`❌ Test failed:`, error);
        process.exit(1);
    }
}
if (require.main === module) {
    main().catch((error) => {
        console.error('❌ Script execution failed:', error);
        process.exit(1);
    });
}
