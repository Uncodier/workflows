"use strict";
/**
 * Test script for createAgentsActivity
 * This script tests the new Supabase-based agent creation functionality
 */
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = require("dotenv");
const siteSetupActivities_1 = require("../temporal/activities/siteSetupActivities");
const agentsConfig_1 = require("../temporal/config/agentsConfig");
const crypto_1 = require("crypto");
// Load environment variables
(0, dotenv_1.config)({ path: '.env.local' });
async function testCreateAgents() {
    console.log('🧪 Testing createAgentsActivity with Supabase');
    console.log('==============================================');
    try {
        // Generate test data
        const testSiteId = (0, crypto_1.randomUUID)();
        const testUserId = (0, crypto_1.randomUUID)();
        console.log('\n📊 Test Data:');
        console.log(`   Site ID: ${testSiteId}`);
        console.log(`   User ID: ${testUserId}`);
        console.log('   Company: Test Company Inc.');
        // Test 1: Basic agent creation
        console.log('\n🔧 Test 1: Creating basic agents...');
        const basicParams = {
            site_id: testSiteId,
            user_id: testUserId,
            company_name: 'Test Company Inc.',
            agent_types: ['customer_support', 'sales']
        };
        const basicResult = await (0, siteSetupActivities_1.createAgentsActivity)(basicParams);
        console.log('✅ Basic agents result:', {
            success: basicResult.success,
            total_created: basicResult.total_created,
            agent_names: basicResult.agents.map(a => a.name)
        });
        // Test 2: Detailed agent creation (select first 3 agents from config)
        console.log('\n🔧 Test 2: Creating detailed agents...');
        const detailedParams = {
            site_id: testSiteId,
            user_id: testUserId,
            company_name: 'Test Company Inc.',
            custom_config: {
                use_detailed_config: true,
                agents_config: agentsConfig_1.defaultAgentsConfig.agents.slice(0, 3) // Take first 3 agents
            }
        };
        const detailedResult = await (0, siteSetupActivities_1.createAgentsActivity)(detailedParams);
        console.log('✅ Detailed agents result:', {
            success: detailedResult.success,
            total_created: detailedResult.total_created,
            agent_names: detailedResult.agents.map(a => a.name),
            agent_types: detailedResult.agents.map(a => a.type)
        });
        console.log('\n🎉 All tests completed successfully!');
        console.log(`   Total agents created: ${basicResult.total_created + detailedResult.total_created}`);
    }
    catch (error) {
        console.error('\n❌ Test failed:', error);
        process.exit(1);
    }
}
// Run the test
testCreateAgents()
    .then(() => {
    console.log('\n✨ Test completed successfully');
    process.exit(0);
})
    .catch((error) => {
    console.error('\n💥 Test failed with error:', error);
    process.exit(1);
});
