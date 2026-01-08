/**
 * Example: How to use the leadCompanyResearchWorkflow
 * 
 * This workflow analyzes a company website to extract key information:
 * - Company summary/overview
 * - Services/products offered
 * - Notable clients or case studies
 * 
 * The extracted information is saved to lead notes and company description.
 */

const { Client } = require('@temporalio/client');

async function runLeadCompanyResearchExample() {
  // Create Temporal client
  const client = new Client({
    // Configure your Temporal service connection here
    // connection: { /* your connection config */ }
  });

  try {
    console.log('🌐 Starting Lead Company Research Workflow Example...');

    // Workflow options
    const workflowOptions = {
      lead_id: 'lead_12345',              // Required: Lead ID
      site_id: 'site_67890',              // Required: Site ID
      website: 'https://example.com',     // Required: Company website URL to analyze
      userId: 'user_11111',               // Optional: User ID (defaults to site owner)
      additionalData: {                   // Optional: Additional parameters
        researchContext: 'company_website_analysis'
      }
    };

    console.log('📋 Workflow Options:', JSON.stringify(workflowOptions, null, 2));

    // Start the workflow
    const handle = await client.workflow.start('leadCompanyResearchWorkflow', {
      args: [workflowOptions],
      taskQueue: 'default',
      workflowId: `lead-company-research-${workflowOptions.lead_id}-${Date.now()}`,
    });

    console.log(`🚀 Workflow started with ID: ${handle.workflowId}`);
    console.log('⏳ Waiting for workflow to complete...');

    // Wait for result
    const result = await handle.result();

    console.log('\n🎉 Lead Company Research Workflow Completed!');
    console.log('📊 Results:');
    console.log(`   ✅ Success: ${result.success}`);
    console.log(`   🔍 Lead ID: ${result.leadId}`);
    console.log(`   🏢 Site: ${result.siteName} (${result.siteUrl})`);
    console.log(`   🌐 Website Analyzed: ${result.website}`);
    console.log(`   ⏱️  Execution Time: ${result.executionTime}`);
    console.log(`   📅 Completed At: ${result.completedAt}`);

    if (result.companyInfo) {
      console.log('\n📋 Company Information Extracted:');
      
      if (result.companyInfo.summary) {
        console.log(`\n📝 Summary:`);
        console.log(`   ${result.companyInfo.summary}`);
      }
      
      if (result.companyInfo.services && result.companyInfo.services.length > 0) {
        console.log(`\n🛠️  Services/Products:`);
        result.companyInfo.services.forEach((service, index) => {
          console.log(`   ${index + 1}. ${service}`);
        });
      }
      
      if (result.companyInfo.clients && result.companyInfo.clients.length > 0) {
        console.log(`\n👥 Notable Clients:`);
        result.companyInfo.clients.forEach((client, index) => {
          console.log(`   ${index + 1}. ${client}`);
        });
      }
    } else {
      console.log('\n⚠️  No company information could be extracted from the website');
    }

    if (result.errors && result.errors.length > 0) {
      console.log('\n⚠️  Errors:');
      result.errors.forEach((error, index) => {
        console.log(`   ${index + 1}. ${error}`);
      });
    }

    return result;

  } catch (error) {
    console.error('❌ Workflow execution failed:', error.message);
    console.error('Stack trace:', error.stack);
    throw error;
  }
}

// Helper function to test with a specific lead and website
async function testWithLeadAndWebsite(leadId, siteId, website, userId = null) {
  console.log(`\n🧪 Testing Lead Company Research for Lead: ${leadId}`);
  console.log(`📍 Website: ${website}`);
  console.log('─'.repeat(50));

  const client = new Client({
    // Configure your Temporal service connection here
  });

  try {
    const workflowOptions = {
      lead_id: leadId,
      site_id: siteId,
      website: website,
      userId: userId,
      additionalData: {
        testMode: true,
        timestamp: new Date().toISOString()
      }
    };

    const handle = await client.workflow.start('leadCompanyResearchWorkflow', {
      args: [workflowOptions],
      taskQueue: 'default',
      workflowId: `lead-company-research-test-${leadId}-${Date.now()}`,
    });

    console.log(`🚀 Workflow started: ${handle.workflowId}`);
    const result = await handle.result();

    console.log('\n✅ Test completed successfully!');
    console.log(`📊 Company info extracted: ${result.companyInfo ? 'Yes' : 'No'}`);
    
    return result;

  } catch (error) {
    console.error(`❌ Test failed: ${error.message}`);
    throw error;
  }
}

// Run the example
if (require.main === module) {
  runLeadCompanyResearchExample()
    .then(() => {
      console.log('\n✅ Example completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Example failed:', error);
      process.exit(1);
    });
}

// Export functions for use in other scripts
module.exports = {
  runLeadCompanyResearchExample,
  testWithLeadAndWebsite
};

