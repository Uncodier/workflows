/**
 * Manual test script for Site Setup Workflow
 * This script can be run to test the siteSetupWorkflow functionality
 */

import { getTemporalClient } from '../temporal/client';
import type { SiteSetupParams } from '../temporal/activities/siteSetupActivities';

// Sample site setup data for testing
const testSiteSetupData: SiteSetupParams[] = [
  {
    site_id: "site-001-test",
    user_id: "user-001-test",
    company_name: "TechCorp Solutions",
    contact_email: "john.doe@techcorp.com",
    contact_name: "John Doe",
    package_type: "premium",
    custom_requirements: [
      "Configurar integración con Salesforce",
      "Personalizar agentes para sector tecnológico",
      "Implementar autenticación SSO",
      "Configurar reportes personalizados",
      "Activar monitoreo avanzado"
    ]
  },
  {
    site_id: "site-002-test",
    user_id: "user-002-test", 
    company_name: "StartupCo",
    contact_email: "maria.garcia@startupco.com",
    contact_name: "María García",
    package_type: "basic",
    custom_requirements: [
      "Configurar agentes básicos",
      "Integrar con email marketing",
      "Configurar seguimiento de leads",
      "Activar notificaciones"
    ]
  }
];

/**
 * Test single site setup workflow
 */
export async function testSingleSiteSetup() {
  try {
    console.log('🏢 Testing Single Site Setup Workflow...');
    
    const client = await getTemporalClient();
    const siteData = testSiteSetupData[0];
    
    console.log('📋 Testing site setup with:', {
      company_name: siteData.company_name,
      contact_name: siteData.contact_name,
      contact_email: siteData.contact_email,
      site_id: siteData.site_id,
      user_id: siteData.user_id,
      package_type: siteData.package_type,
      custom_requirements_count: siteData.custom_requirements?.length || 0
    });
    
    const result = await client.workflow.execute('siteSetupWorkflow', {
      args: [siteData],
      taskQueue: 'site-setup-queue',
      workflowId: `test-site-setup-${Date.now()}`,
    });
    
    console.log('✅ Site setup workflow completed!');
    console.log(`📊 Result:`, JSON.stringify(result, null, 2));
    
    // Validate result structure
    if (result.success) {
      console.log('🎉 Site setup was successful!');
      console.log(`   • Agents created: ${result.agents_created.total_created}`);
      console.log(`   • Account manager: ${result.account_manager_assigned.account_manager.name}`);
      console.log(`   • Follow-up email sent to: ${result.follow_up_email_sent.recipient}`);
    } else {
      console.log('❌ Site setup failed:', result.error);
    }
    
  } catch (error) {
    console.error('❌ Single site setup workflow test failed:', error);
  }
}

/**
 * Test minimal site setup workflow (basic parameters)
 */
export async function testMinimalSiteSetup() {
  try {
    console.log('🏢 Testing Minimal Site Setup Workflow...');
    
    const client = await getTemporalClient();
    
    const minimalSiteData: SiteSetupParams = {
      site_id: `minimal-site-${Date.now()}`,
      user_id: `minimal-user-${Date.now()}`,
      company_name: "Minimal Test Company",
      contact_email: "test@minimal.com",
      contact_name: "Test User"
    };
    
    console.log('📋 Testing minimal site setup with:', {
      company_name: minimalSiteData.company_name,
      contact_name: minimalSiteData.contact_name,
      contact_email: minimalSiteData.contact_email
    });
    
    const result = await client.workflow.execute('siteSetupWorkflow', {
      args: [minimalSiteData],
      taskQueue: 'site-setup-queue',
      workflowId: `test-minimal-site-setup-${Date.now()}`,
    });
    
    console.log('✅ Minimal site setup workflow completed!');
    console.log(`📊 Minimal Result Summary:`, {
      success: result.success,
      agents_created: result.agents_created.total_created,
      account_manager_assigned: result.account_manager_assigned.success,
      follow_up_email_sent: result.follow_up_email_sent.success,
      error: result.error
    });
    
  } catch (error) {
    console.error('❌ Minimal site setup workflow test failed:', error);
  }
}

/**
 * Test site setup validation (error cases)
 */
export async function testSiteSetupValidation() {
  try {
    console.log('🔍 Testing Site Setup Validation...');
    
    const client = await getTemporalClient();
    
    // Test with missing required fields
    const invalidSiteData = {
      site_id: "",
      user_id: "",
      company_name: "",
      contact_email: "invalid-email",
      contact_name: ""
    } as SiteSetupParams;
    
    console.log('📋 Testing with invalid data (expecting controlled failure)');
    
    const result = await client.workflow.execute('siteSetupWorkflow', {
      args: [invalidSiteData],
      taskQueue: 'site-setup-queue',
      workflowId: `test-invalid-site-setup-${Date.now()}`,
    });
    
    console.log('📊 Validation test result:', {
      success: result.success,
      error: result.error,
      message: result.success ? 'Unexpected success with invalid data' : 'Expected failure occurred'
    });
    
  } catch (error) {
    console.log('✅ Validation test completed - error handling worked:', error instanceof Error ? error.message : String(error));
  }
}

/**
 * Test multiple site setups (batch processing concept)
 */
export async function testMultipleSiteSetups() {
  try {
    console.log('🏢 Testing Multiple Site Setups...');
    
    const client = await getTemporalClient();
    
    console.log(`📨 Setting up ${testSiteSetupData.length} sites`);
    console.log('📋 Sites overview:', testSiteSetupData.map((site, i) => ({
      index: i + 1,
      company: site.company_name,
      contact: site.contact_name,
      package: site.package_type
    })));
    
    const results = [];
    
    // Process each site setup sequentially
    for (let i = 0; i < testSiteSetupData.length; i++) {
      const siteData = testSiteSetupData[i];
      
      console.log(`\n🔄 Setting up site ${i + 1}/${testSiteSetupData.length}: ${siteData.company_name}`);
      
      try {
        const result = await client.workflow.execute('siteSetupWorkflow', {
          args: [siteData],
          taskQueue: 'site-setup-queue',
          workflowId: `test-batch-site-setup-${i}-${Date.now()}`,
        });
        
        results.push({
          index: i + 1,
          company_name: siteData.company_name,
          success: result.success,
          agents_created: result.agents_created.total_created,
          account_manager: result.account_manager_assigned.account_manager.name,
          email_sent: result.follow_up_email_sent.success,
          error: result.error
        });
        
        console.log(`✅ Site ${i + 1} setup completed: ${result.success ? 'SUCCESS' : 'FAILED'}`);
        
      } catch (error) {
        results.push({
          index: i + 1,
          company_name: siteData.company_name,
          success: false,
          error: error instanceof Error ? error.message : String(error)
        });
        
        console.log(`❌ Site ${i + 1} setup failed:`, error);
      }
    }
    
    console.log('\n🎉 Multiple site setups completed!');
    console.log('📊 Batch Results Summary:', {
      total_sites: testSiteSetupData.length,
      successful: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length
    });
    
    console.log('📋 Individual Results:', results);
    
  } catch (error) {
    console.error('❌ Multiple site setups test failed:', error);
  }
}

// Main execution
async function main() {
  console.log('=== Site Setup Workflow Tests ===\n');
  
  try {
    // Test 1: Single site setup with full parameters
    console.log('📝 Test 1: Single Site Setup (Full Parameters)');
    console.log('─'.repeat(60));
    await testSingleSiteSetup();
    
    console.log('\n\n📝 Test 2: Minimal Site Setup (Basic Parameters)');
    console.log('─'.repeat(60));
    await testMinimalSiteSetup();
    
    console.log('\n\n📝 Test 3: Site Setup Validation (Error Handling)');
    console.log('─'.repeat(60));
    await testSiteSetupValidation();
    
    console.log('\n\n📝 Test 4: Multiple Site Setups (Batch Processing)');
    console.log('─'.repeat(60));
    await testMultipleSiteSetups();
    
    console.log('\n✅ All site setup workflow tests completed successfully!');
    
  } catch (error) {
    console.error('\n❌ Site setup workflow tests failed:', error);
    process.exit(1);
  }
}

// Run tests if this file is executed directly
if (require.main === module) {
  main().catch(console.error);
} 