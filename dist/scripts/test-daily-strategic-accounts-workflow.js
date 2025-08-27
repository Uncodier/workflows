"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.testDailyStrategicAccountsWorkflow = testDailyStrategicAccountsWorkflow;
const client_1 = require("../temporal/client");
async function testDailyStrategicAccountsWorkflow() {
    try {
        console.log('🎯 Testing Daily Strategic Accounts Workflow...');
        // Connect to Temporal
        const client = await (0, client_1.getTemporalClient)();
        console.log('✅ Connected to Temporal Cloud');
        // Replace with a valid site_id from your database
        const testSiteId = process.env.TEST_SITE_ID || 'your-site-id-here';
        if (testSiteId === 'your-site-id-here') {
            console.error('❌ Please set TEST_SITE_ID environment variable with a valid site ID');
            process.exit(1);
        }
        const options = {
            site_id: testSiteId,
            userId: process.env.TEST_USER_ID, // Optional
            maxLeads: 10, // Limit to 10 strategic leads for testing
            updateStatus: false, // Don't update lead status for testing
            additionalData: {
                testRun: true,
                executedBy: 'test-script',
                timestamp: new Date().toISOString(),
                searchType: 'strategic_accounts'
            }
        };
        console.log('📋 Starting strategic accounts workflow with options:', JSON.stringify(options, null, 2));
        // Start the workflow
        const handle = await client.workflow.start('dailyStrategicAccountsWorkflow', {
            args: [options],
            taskQueue: 'default',
            workflowId: `daily-strategic-accounts-test-${testSiteId}-${Date.now()}`,
            workflowRunTimeout: '15m', // Longer timeout for strategic account generation
        });
        console.log(`🚀 Strategic accounts workflow started with ID: ${handle.workflowId}`);
        console.log(`📊 Following execution...`);
        // Wait for result
        const result = await handle.result();
        console.log('\n🎉 Strategic accounts workflow completed successfully!');
        console.log('📊 Results:', JSON.stringify(result, null, 2));
        // Summary
        console.log('\n📋 Strategic Accounts Summary:');
        console.log(`   - Site: ${result.siteName || result.siteId}`);
        console.log(`   - Strategic leads generated: ${result.leadsGenerated}`);
        console.log(`   - Strategic leads filtered: ${result.leadsFiltered}`);
        console.log(`   - Strategic leads processed: ${result.leadsProcessed}`);
        console.log(`   - Tasks created: ${result.tasksCreated}`);
        console.log(`   - Status updated: ${result.statusUpdated}`);
        console.log(`   - Leads assigned to humans: ${result.assignedLeads?.length || 0}`);
        console.log(`   - Follow-up workflows started: ${result.followUpWorkflowsStarted || 0}`);
        console.log(`   - Execution time: ${result.executionTime}`);
        if (result.strategicCriteria) {
            console.log('\n🌍 Strategic Search Criteria:');
            console.log(`   - Region: ${result.strategicCriteria.region}`);
            console.log(`   - Keywords: ${result.strategicCriteria.keywords}`);
            console.log(`   - Search Type: ${result.strategicCriteria.searchType}`);
        }
        if (result.channelFilteringInfo) {
            console.log('\n📡 Channel Filtering Info:');
            console.log(`   - Has Email Channel: ${result.channelFilteringInfo.hasEmailChannel ? '✅' : '❌'}`);
            console.log(`   - Has WhatsApp Channel: ${result.channelFilteringInfo.hasWhatsappChannel ? '✅' : '❌'}`);
            console.log(`   - Leads with email: ${result.channelFilteringInfo.leadsWithEmail}`);
            console.log(`   - Leads with phone: ${result.channelFilteringInfo.leadsWithPhone}`);
            console.log(`   - Leads with both: ${result.channelFilteringInfo.leadsWithBoth}`);
            console.log(`   - Leads filtered out: ${result.channelFilteringInfo.leadsFilteredOut}`);
        }
        if (result.errors.length > 0) {
            console.log(`   - Errors: ${result.errors.length}`);
            result.errors.forEach((error, index) => {
                console.log(`     ${index + 1}. ${error}`);
            });
        }
        // Show strategic account results details
        if (result.strategicAccountResults.length > 0) {
            console.log('\n👥 Strategic Account Results:');
            result.strategicAccountResults.forEach((strategicResult, index) => {
                const lead = strategicResult.lead;
                console.log(`   ${index + 1}. ${lead.name || lead.email} (${lead.company || 'No company'})`);
                console.log(`      - Task created: ${strategicResult.taskCreated ? '✅' : '❌'}`);
                if (strategicResult.taskId) {
                    console.log(`      - Task ID: ${strategicResult.taskId}`);
                }
                console.log(`      - Status updated: ${strategicResult.statusUpdated ? '✅' : '❌'}`);
                if (strategicResult.errors.length > 0) {
                    console.log(`      - Errors: ${strategicResult.errors.join(', ')}`);
                }
            });
        }
        // Show sales agent and assignment info
        if (result.salesAgentResponse) {
            console.log('\n🤖 Sales Agent Processing:');
            console.log(`   - Selected leads: ${result.selectedLeads?.length || 0}`);
            console.log(`   - Assigned leads: ${result.assignedLeads?.length || 0}`);
            console.log(`   - Notifications sent: ${result.notificationResults?.filter((r) => r.success).length || 0}/${result.notificationResults?.length || 0}`);
        }
        // Show follow-up workflow info
        if (result.followUpResults && result.followUpResults.length > 0) {
            console.log('\n🔄 Follow-up Workflows:');
            result.followUpResults.forEach((followUp, index) => {
                console.log(`   ${index + 1}. ${followUp.lead_name}: ${followUp.success ? '✅ Started' : '❌ Failed'}`);
                if (followUp.workflowId) {
                    console.log(`      - Workflow ID: ${followUp.workflowId}`);
                }
                if (followUp.error) {
                    console.log(`      - Error: ${followUp.error}`);
                }
            });
        }
    }
    catch (error) {
        console.error('❌ Strategic accounts workflow execution failed:', error);
        if (error instanceof Error) {
            console.error('Error details:', error.message);
            console.error('Stack trace:', error.stack);
        }
        process.exit(1);
    }
}
// Run if called directly
if (require.main === module) {
    testDailyStrategicAccountsWorkflow()
        .then(() => {
        console.log('\n✅ Strategic accounts test completed successfully');
        process.exit(0);
    })
        .catch((error) => {
        console.error('\n❌ Strategic accounts test failed:', error);
        process.exit(1);
    });
}
