import { getTemporalClient } from '../temporal/client';
import { leadInvalidationWorkflow, type LeadInvalidationOptions } from '../temporal/workflows/leadInvalidationWorkflow';

/**
 * Test script to debug lead invalidation functionality
 * This script will test invalidating a specific lead and verify the database changes
 */
async function testLeadInvalidationDebug() {
  console.log('🧪 Testing Lead Invalidation Workflow Debug');
  console.log('='.repeat(60));
  
  const client = await getTemporalClient();

  // Test lead ID - replace with an actual lead ID from your database
  const testLeadId = process.env.TEST_LEAD_ID || 'YOUR_LEAD_ID_HERE';
  const testSiteId = process.env.TEST_SITE_ID || 'YOUR_SITE_ID_HERE';
  
  if (testLeadId === 'YOUR_LEAD_ID_HERE' || testSiteId === 'YOUR_SITE_ID_HERE') {
    console.log('❌ Please set TEST_LEAD_ID and TEST_SITE_ID environment variables');
    console.log('Example: TEST_LEAD_ID=123 TEST_SITE_ID=abc npm run test:lead-invalidation-debug');
    process.exit(1);
  }

  try {
    console.log(`🔍 Testing lead invalidation for lead: ${testLeadId}`);
    console.log(`📍 Site ID: ${testSiteId}`);
    
    // First, let's check the lead's current state
    console.log('\n📋 Step 1: Checking lead current state...');
    await checkLeadState(testLeadId, 'BEFORE');
    
    // Test invalidation workflow
    const invalidationOptions: LeadInvalidationOptions = {
      lead_id: testLeadId,
      site_id: testSiteId,
      reason: 'whatsapp_failed',
      telephone: '+1234567890', // Example failed number
      email: 'test@example.com', // Example failed email
      userId: 'test-user-id',
      additionalData: {
        test_run: true,
        test_timestamp: new Date().toISOString()
      }
    };

    console.log('\n🚀 Step 2: Running lead invalidation workflow...');
    console.log('📝 Options:', JSON.stringify(invalidationOptions, null, 2));
    
    const workflowId = `test-lead-invalidation-${testLeadId}-${Date.now()}`;
    
    const handle = await client.workflow.start(leadInvalidationWorkflow, {
      taskQueue: 'lead-invalidation',
      workflowId,
      args: [invalidationOptions],
    });

    console.log(`⏳ Workflow started with ID: ${handle.workflowId}`);
    console.log('⏳ Waiting for workflow completion...');

    const result = await handle.result();
    
    console.log('\n✅ Workflow completed!');
    console.log('📊 Result:', JSON.stringify(result, null, 2));
    
    // Check the lead's state after invalidation
    console.log('\n🔍 Step 3: Checking lead state after invalidation...');
    await checkLeadState(testLeadId, 'AFTER');
    
    // Summary
    console.log('\n📋 SUMMARY:');
    console.log('='.repeat(40));
    console.log(`✅ Workflow success: ${result.success}`);
    console.log(`🚫 Lead invalidated: ${result.invalidatedLead}`);
    console.log(`📊 Shared leads invalidated: ${result.invalidatedSharedLeads}`);
    console.log(`🏢 Company added to null list: ${result.companyAddedToNullList}`);
    console.log(`⚠️ Errors: ${result.errors.length}`);
    
    if (result.errors.length > 0) {
      console.log('❌ Errors encountered:');
      result.errors.forEach((error: string, index: number) => {
        console.log(`   ${index + 1}. ${error}`);
      });
    }

  } catch (error) {
    console.error('❌ Test failed:', error);
    throw error;
  }
}

/**
 * Helper function to check lead state in the database
 */
async function checkLeadState(leadId: string, stage: 'BEFORE' | 'AFTER') {
  try {
    // Import supabase service role client
    const { supabaseServiceRole } = await import('../lib/supabase/client');
    
    const { data: lead, error } = await supabaseServiceRole
      .from('leads')
      .select('id, site_id, status, metadata, email, phone, name, updated_at')
      .eq('id', leadId)
      .single();
    
    if (error) {
      console.error(`❌ Error fetching lead ${stage}:`, error.message);
      return;
    }
    
    if (!lead) {
      console.log(`❌ Lead ${leadId} not found`);
      return;
    }
    
    console.log(`📋 Lead state ${stage}:`);
    console.log(`   - ID: ${lead.id}`);
    console.log(`   - Name: ${lead.name || 'N/A'}`);
    console.log(`   - Email: ${lead.email || 'N/A'}`);
    console.log(`   - Phone: ${lead.phone || 'N/A'}`);
    console.log(`   - Site ID: ${lead.site_id || 'NULL (INVALIDATED)'}`);
    console.log(`   - Status: ${lead.status || 'N/A'}`);
    console.log(`   - Updated: ${lead.updated_at}`);
    console.log(`   - Has metadata: ${lead.metadata ? 'YES' : 'NO'}`);
    
    if (lead.metadata) {
      console.log(`   - Metadata keys: [${Object.keys(lead.metadata).join(', ')}]`);
      
      // Show invalidation-specific metadata
      if (lead.metadata.invalidated) {
        console.log(`   - Invalidated: ${lead.metadata.invalidated}`);
        console.log(`   - Invalidated at: ${lead.metadata.invalidated_at || 'N/A'}`);
        console.log(`   - Reason: ${lead.metadata.invalidation_reason || 'N/A'}`);
        console.log(`   - Original site ID: ${lead.metadata.original_site_id || 'N/A'}`);
        console.log(`   - Pending revalidation: ${lead.metadata.pending_revalidation || false}`);
      }
    }
    
  } catch (error) {
    console.error(`❌ Exception checking lead state ${stage}:`, error);
  }
}

// Only run if this script is executed directly
if (require.main === module) {
  testLeadInvalidationDebug()
    .then(() => {
      console.log('\n🎉 Test completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Test failed:', error);
      process.exit(1);
    });
}

export { testLeadInvalidationDebug }; 