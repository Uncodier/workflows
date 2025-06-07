#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("../temporal/client");
const workflows_1 = require("../temporal/workflows");
async function run() {
    // Use the configured Temporal client
    const client = await (0, client_1.getTemporalClient)();
    // Test parameters for buildCampaignsWorkflow
    const testParams = {
        site_id: "9be0a6a2-5567-41bf-ad06-cb4014f0faf2",
        campaignData: {
            segmentIds: []
        }
    };
    console.log('🚀 Testing buildCampaignsWorkflow...');
    console.log('📊 Test parameters:', JSON.stringify(testParams, null, 2));
    try {
        const handle = await client.workflow.start(workflows_1.workflows.buildCampaignsWorkflow, {
            taskQueue: 'default',
            workflowId: 'test-build-campaigns-' + Date.now(),
            args: [testParams],
        });
        console.log('✅ Started workflow:', handle.workflowId);
        // Wait for the result
        const result = await handle.result();
        console.log('📈 Workflow result:', JSON.stringify(result, null, 2));
        if (result.success) {
            console.log('🎉 Workflow completed successfully!');
        }
        else {
            console.log('❌ Workflow completed with errors:', result.error);
        }
    }
    catch (error) {
        console.error('💥 Workflow execution failed:', error);
        process.exit(1);
    }
}
run().catch((err) => {
    console.error('💥 Failed to execute workflow:', err);
    process.exit(1);
});
