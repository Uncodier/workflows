/**
 * Test script for Lead Invalidation Workflow
 * This script tests the leadInvalidationWorkflow functionality
 */

import { getTemporalClient } from '../temporal/client';
import type { LeadInvalidationOptions } from '../temporal/workflows/leadInvalidationWorkflow';

// Test data for lead invalidation scenarios
const testInvalidationScenarios: LeadInvalidationOptions[] = [
  {
    lead_id: "test-lead-001",
    site_id: "9be0a6a2-5567-41bf-ad06-cb4014f0faf2",
    telephone: "+346632112233", // Failed phone number
    reason: 'whatsapp_failed',
    userId: "541396e1-a904-4a81-8cbf-0ca4e3b8b2b4",
    additionalData: {
      original_phone: "663 211 22 33",
      formatted_phone: "+346632112233",
      whatsapp_error: "Invalid phone format",
      failed_in_workflow: "leadFollowUpWorkflow",
      failed_at: new Date().toISOString()
    }
  },
  {
    lead_id: "test-lead-002",
    site_id: "9be0a6a2-5567-41bf-ad06-cb4014f0faf2",
    email: "invalid@nonexistent-domain.com",
    reason: 'email_failed',
    userId: "541396e1-a904-4a81-8cbf-0ca4e3b8b2b4",
    additionalData: {
      email_error: "Domain not found",
      failed_in_workflow: "sendEmailFromAgentWorkflow",
      failed_at: new Date().toISOString()
    }
  },
  {
    lead_id: "test-lead-003",
    site_id: "9be0a6a2-5567-41bf-ad06-cb4014f0faf2",
    telephone: "+346632112233",
    email: "shared@company.com",
    reason: 'invalid_contact',
    userId: "541396e1-a904-4a81-8cbf-0ca4e3b8b2b4",
    additionalData: {
      validation_error: "Contact information verification failed",
      failed_at: new Date().toISOString()
    }
  }
];

/**
 * Test single lead invalidation workflow
 */
export async function testSingleLeadInvalidation() {
  try {
    console.log('🧪 Testing single lead invalidation workflow...');
    
    const client = await getTemporalClient();
    const testCase = testInvalidationScenarios[0];
    
    console.log('📋 Test case details:', JSON.stringify(testCase, null, 2));
    
    const startTime = Date.now();
    
    const result = await client.workflow.execute('leadInvalidationWorkflow', {
      args: [testCase],
      taskQueue: 'default',
      workflowId: `test-lead-invalidation-${Date.now()}`,
    });
    
    const duration = Date.now() - startTime;
    
    console.log('✅ Lead invalidation workflow completed successfully!');
    console.log(`⏱️ Duration: ${duration}ms`);
    console.log('📊 Result:', JSON.stringify(result, null, 2));
    
    if (result.success) {
      console.log(`🎉 SUCCESS: Lead ${result.leadId} invalidation completed`);
      console.log(`   - Lead invalidated: ${result.invalidatedLead}`);
      console.log(`   - Shared leads invalidated: ${result.invalidatedSharedLeads}`);
      console.log(`   - Original site_id: ${result.originalSiteId}`);
      console.log(`   - Reason: ${result.reason}`);
      console.log(`   - Execution time: ${result.executionTime}`);
    } else {
      console.log(`❌ FAILURE: Lead invalidation failed`);
      console.log(`   - Errors: ${result.errors.join(', ')}`);
    }
    
    return result;
    
  } catch (error) {
    console.error('❌ Lead invalidation test failed:', error);
    throw error;
  }
}

/**
 * Test multiple lead invalidation scenarios
 */
export async function testMultipleLeadInvalidationScenarios() {
  try {
    console.log('🧪 Testing multiple lead invalidation scenarios...');
    
    const client = await getTemporalClient();
    const results = [];
    
    for (let i = 0; i < testInvalidationScenarios.length; i++) {
      const testCase = testInvalidationScenarios[i];
      
      console.log(`\n📋 Running test scenario ${i + 1}/${testInvalidationScenarios.length}:`);
      console.log(`   - Lead ID: ${testCase.lead_id}`);
      console.log(`   - Reason: ${testCase.reason}`);
      console.log(`   - Failed contact: ${testCase.telephone ? 'phone' : ''}${testCase.email ? 'email' : ''}`);
      
      try {
        const startTime = Date.now();
        
        const result = await client.workflow.execute('leadInvalidationWorkflow', {
          args: [testCase],
          taskQueue: 'default',
          workflowId: `test-lead-invalidation-scenario-${i + 1}-${Date.now()}`,
        });
        
        const duration = Date.now() - startTime;
        
        console.log(`✅ Scenario ${i + 1} completed in ${duration}ms`);
        
        if (result.success) {
          console.log(`   🎉 Lead ${result.leadId} invalidated successfully`);
          console.log(`   📊 Invalidated lead: ${result.invalidatedLead}, Shared: ${result.invalidatedSharedLeads}`);
        } else {
          console.log(`   ❌ Invalidation failed: ${result.errors.join(', ')}`);
        }
        
        results.push({
          scenario: i + 1,
          success: result.success,
          duration,
          result
        });
        
        // Add delay between tests to avoid overwhelming the system
        if (i < testInvalidationScenarios.length - 1) {
          console.log('⏱️ Waiting 2 seconds before next test...');
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
        
      } catch (scenarioError) {
        console.error(`❌ Scenario ${i + 1} failed:`, scenarioError);
        results.push({
          scenario: i + 1,
          success: false,
          duration: 0,
          error: scenarioError instanceof Error ? scenarioError.message : String(scenarioError)
        });
      }
    }
    
    // Summary
    console.log('\n📊 Test Summary:');
    const successful = results.filter(r => r.success).length;
    const failed = results.length - successful;
    
    console.log(`   ✅ Successful: ${successful}/${results.length}`);
    console.log(`   ❌ Failed: ${failed}/${results.length}`);
    
    if (failed > 0) {
      console.log('\n❌ Failed scenarios:');
      results.filter(r => !r.success).forEach(r => {
        console.log(`   - Scenario ${r.scenario}: ${r.error || 'Unknown error'}`);
      });
    }
    
    return results;
    
  } catch (error) {
    console.error('❌ Multiple lead invalidation test failed:', error);
    throw error;
  }
}

/**
 * Test lead invalidation with validation
 */
export async function testLeadInvalidationWithValidation() {
  try {
    console.log('🧪 Testing lead invalidation with validation...');
    
    const testCase = {
      lead_id: "",  // Invalid: empty lead_id
      site_id: "9be0a6a2-5567-41bf-ad06-cb4014f0faf2",
      reason: 'whatsapp_failed' as const,
      userId: "541396e1-a904-4a81-8cbf-0ca4e3b8b2b4"
    };
    
    console.log('📋 Testing validation with invalid lead_id (empty)');
    
    const client = await getTemporalClient();
    
    try {
      await client.workflow.execute('leadInvalidationWorkflow', {
        args: [testCase],
        taskQueue: 'default',
        workflowId: `test-validation-invalidation-${Date.now()}`,
      });
      
      console.log('⚠️ WARNING: Validation test should have failed but didn\'t');
      
    } catch (validationError) {
      console.log('✅ SUCCESS: Validation failed as expected');
      console.log('📋 Validation error:', validationError instanceof Error ? validationError.message : String(validationError));
    }
    
  } catch (error) {
    console.error('❌ Lead invalidation validation test failed:', error);
    throw error;
  }
}

/**
 * Main test function
 */
async function main() {
  console.log('🚀 Starting Lead Invalidation Workflow Tests...\n');
  
  try {
    // Test 1: Single lead invalidation
    await testSingleLeadInvalidation();
    
    console.log('\n' + '='.repeat(60) + '\n');
    
    // Test 2: Multiple scenarios
    await testMultipleLeadInvalidationScenarios();
    
    console.log('\n' + '='.repeat(60) + '\n');
    
    // Test 3: Validation
    await testLeadInvalidationWithValidation();
    
    console.log('\n🎉 All lead invalidation tests completed!');
    
  } catch (error) {
    console.error('\n❌ Test suite failed:', error);
    process.exit(1);
  }
}

// Run tests if this file is executed directly
if (require.main === module) {
  main().catch(console.error);
} 