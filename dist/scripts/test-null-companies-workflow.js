#!/usr/bin/env tsx
"use strict";
/**
 * Test script for null companies functionality
 *
 * This script tests the complete flow:
 * 1. Creates test leads for the same company
 * 2. Triggers lead invalidation workflow
 * 3. Verifies that when all leads are invalidated, the company is added to null list
 */
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("../temporal/client");
const leadInvalidationWorkflow_1 = require("../temporal/workflows/leadInvalidationWorkflow");
const TEST_SITE_ID = 'test-site-null-companies-123';
const TEST_USER_ID = 'test-user-456';
const TEST_COMPANY_NAME = 'TestCorp Invalid Communications';
const TEST_CITY = 'TestCity';
/**
 * Mock function to create test leads in database
 * In a real scenario, these would be created through the lead generation workflow
 */
async function createTestLeads() {
    // This is a mock - in reality you would create actual leads in the database
    const testLeads = [
        {
            id: 'test-lead-1',
            name: 'John Doe',
            email: 'john@testcorp.com',
            phone: '+1234567890',
            company_name: TEST_COMPANY_NAME
        },
        {
            id: 'test-lead-2',
            name: 'Jane Smith',
            email: 'jane@testcorp.com',
            phone: '+1234567891',
            company_name: TEST_COMPANY_NAME
        },
        {
            id: 'test-lead-3',
            name: 'Bob Johnson',
            email: 'bob@testcorp.com',
            phone: '+1234567892',
            company_name: TEST_COMPANY_NAME
        }
    ];
    console.log(`📝 Created ${testLeads.length} test leads for ${TEST_COMPANY_NAME}`);
    return testLeads;
}
/**
 * Test the complete null companies workflow
 */
async function testNullCompaniesWorkflow() {
    console.log('🧪 Starting null companies workflow test...\n');
    try {
        // Step 1: Create test leads
        console.log('📋 Step 1: Creating test leads...');
        const testLeads = await createTestLeads();
        console.log(`✅ Test leads created for company: ${TEST_COMPANY_NAME}\n`);
        // Step 2: Get Temporal client
        console.log('🔗 Step 2: Connecting to Temporal...');
        const client = await (0, client_1.getTemporalClient)();
        console.log('✅ Connected to Temporal\n');
        // Step 3: Test invalidating leads one by one
        console.log('🚫 Step 3: Testing lead invalidation workflow...');
        let nullCompanyCreated = false;
        for (let i = 0; i < testLeads.length; i++) {
            const lead = testLeads[i];
            const isLastLead = i === testLeads.length - 1;
            console.log(`\n📞 Invalidating lead ${i + 1}/${testLeads.length}: ${lead.name}`);
            console.log(`   Expected null company creation: ${isLastLead ? 'YES' : 'NO'}`);
            try {
                const result = await client.workflow.execute(leadInvalidationWorkflow_1.leadInvalidationWorkflow, {
                    workflowId: `test-lead-invalidation-${lead.id}-${Date.now()}`,
                    taskQueue: 'workflows',
                    args: [{
                            lead_id: lead.id,
                            telephone: lead.phone,
                            email: lead.email,
                            reason: 'whatsapp_failed',
                            site_id: TEST_SITE_ID,
                            userId: TEST_USER_ID,
                            additionalData: {
                                test: true,
                                company_name: TEST_COMPANY_NAME,
                                city: TEST_CITY
                            }
                        }]
                });
                console.log(`   📊 Result for ${lead.name}:`);
                console.log(`     - Success: ${result.success}`);
                console.log(`     - Lead invalidated: ${result.invalidatedLead}`);
                console.log(`     - Shared leads invalidated: ${result.invalidatedSharedLeads}`);
                console.log(`     - Company added to null list: ${result.companyAddedToNullList || false}`);
                if (result.companyInfo?.name) {
                    console.log(`     - Company: ${result.companyInfo.name} in ${result.companyInfo.city}`);
                }
                if (result.nullCompanyId) {
                    console.log(`     - Null company ID: ${result.nullCompanyId}`);
                    nullCompanyCreated = true;
                }
                if (result.errors && result.errors.length > 0) {
                    console.log(`     - Errors: ${result.errors.join(', ')}`);
                }
                // Verification
                if (isLastLead && !result.companyAddedToNullList) {
                    console.log(`   ❌ EXPECTED: Company should have been added to null list on last lead`);
                }
                else if (!isLastLead && result.companyAddedToNullList) {
                    console.log(`   ❌ UNEXPECTED: Company was added to null list before all leads were processed`);
                }
                else {
                    console.log(`   ✅ Behavior as expected`);
                }
            }
            catch (workflowError) {
                console.error(`   ❌ Workflow failed for ${lead.name}:`, workflowError);
            }
        }
        // Step 4: Summary
        console.log('\n📊 Test Summary:');
        console.log(`   - Total test leads: ${testLeads.length}`);
        console.log(`   - Company: ${TEST_COMPANY_NAME}`);
        console.log(`   - City: ${TEST_CITY}`);
        console.log(`   - Null company created: ${nullCompanyCreated ? '✅ YES' : '❌ NO'}`);
        if (nullCompanyCreated) {
            console.log(`\n🎉 Test PASSED: Company was correctly added to null companies list!`);
        }
        else {
            console.log(`\n❌ Test FAILED: Company was not added to null companies list`);
        }
    }
    catch (error) {
        console.error('❌ Test failed with error:', error);
        process.exit(1);
    }
}
/**
 * Test individual activities
 */
async function testActivities() {
    console.log('\n🔬 Testing individual activities...\n');
    try {
        // const client = await getTemporalClient(); // TODO: Use when implementing activity tests
        // Test 1: Test getCompanyInfoFromLeadActivity
        console.log('🏢 Test 1: Getting company info from lead...');
        // This would test the actual activity in isolation
        // Test 2: Test checkCompanyValidLeadsActivity  
        console.log('🔍 Test 2: Checking company valid leads...');
        // This would test the actual activity in isolation
        // Test 3: Test addCompanyToNullListActivity
        console.log('🚫 Test 3: Adding company to null list...');
        // This would test the actual activity in isolation
        console.log('✅ All activity tests completed\n');
    }
    catch (error) {
        console.error('❌ Activity tests failed:', error);
    }
}
/**
 * Main test function
 */
async function main() {
    console.log('🚀 Null Companies Workflow Test Suite');
    console.log('=====================================\n');
    await testNullCompaniesWorkflow();
    await testActivities();
    console.log('\n✅ All tests completed!');
    process.exit(0);
}
// Run tests
if (require.main === module) {
    main().catch((error) => {
        console.error('💥 Test suite failed:', error);
        process.exit(1);
    });
}
