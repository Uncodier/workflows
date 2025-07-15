"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const config_1 = require("../config/config");
const { leadGenerationWorkflow } = require('../temporal/workflows/leadGenerationWorkflow');
async function testLeadGenerationExclusion() {
    console.log('🧪 Testing Lead Generation Exclusion Functionality');
    try {
        // Connect to Temporal using the same pattern as existing client
        const { Connection, Client } = require('@temporalio/client');
        const connection = await Connection.connect({
            address: config_1.temporalConfig.serverUrl || 'localhost:7233'
        });
        const client = new Client({
            connection,
            namespace: config_1.temporalConfig.namespace || 'default',
        });
        // Test with a site that has existing leads
        const testSiteId = 'test-site-123';
        const testOptions = {
            site_id: testSiteId,
            userId: 'test-user-123',
            create: false, // Validation mode only
            additionalData: {
                test_mode: true,
                test_description: 'Testing lead generation exclusion functionality'
            }
        };
        console.log('📋 Starting lead generation workflow test...');
        console.log('Options:', JSON.stringify(testOptions, null, 2));
        const workflowHandle = await client.workflow.start(leadGenerationWorkflow, {
            args: [testOptions],
            taskQueue: 'lead-generation-queue',
            workflowId: `test-lead-generation-exclusion-${Date.now()}`,
        });
        console.log('⏳ Workflow started, waiting for result...');
        const result = await workflowHandle.result();
        console.log('✅ Lead generation workflow completed!');
        console.log('📊 Result Summary:');
        console.log(`   - Success: ${result.success}`);
        console.log(`   - Site: ${result.siteName} (${result.siteUrl})`);
        console.log(`   - Target City: ${result.targetCity || 'Not specified'}`);
        console.log(`   - Target Region: ${result.targetRegion || 'Not specified'}`);
        console.log(`   - Excluded Venues: ${result.excludedVenuesCount || 0} companies`);
        if (result.excludedVenues && result.excludedVenues.length > 0) {
            console.log(`   - Excluded Companies: ${result.excludedVenues.join(', ')}`);
        }
        console.log(`   - Business Types: ${result.businessTypes?.length || 0}`);
        console.log(`   - Enhanced Search Topic: ${result.enhancedSearchTopic || 'Not generated'}`);
        console.log(`   - Venues Found: ${result.venuesFound?.length || 0}`);
        console.log(`   - Companies Created: ${result.companiesCreated?.length || 0}`);
        console.log(`   - Companies Processed: ${result.companyResults?.length || 0}`);
        console.log(`   - Total Leads Generated: ${result.totalLeadsGenerated || 0}`);
        console.log(`   - Execution Time: ${result.executionTime}`);
        if (result.errors && result.errors.length > 0) {
            console.log('⚠️  Errors encountered:');
            result.errors.forEach((error, index) => {
                console.log(`   ${index + 1}. ${error}`);
            });
        }
        if (result.excludedVenuesCount > 0) {
            console.log('✅ Exclusion functionality is working correctly!');
        }
        else {
            console.log('ℹ️  No venues were excluded (either no existing leads or no target city)');
        }
    }
    catch (error) {
        console.error('❌ Test failed:', error);
    }
}
// Run the test
testLeadGenerationExclusion().catch(console.error);
