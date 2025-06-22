/**
 * Example: How to use the leadResearchWorkflow
 * 
 * This workflow researches a specific lead using the sales agent API
 * and returns insights and recommendations.
 */

const { Client } = require('@temporalio/client');

async function runLeadResearchExample() {
  // Create Temporal client
  const client = new Client({
    // Configure your Temporal service connection here
    // connection: { /* your connection config */ }
  });

  try {
    console.log('🔍 Starting Lead Research Workflow Example...');

    // Workflow options
    const workflowOptions = {
      lead_id: 'lead_12345',          // Required: Lead ID to research
      site_id: 'site_67890',         // Required: Site ID
      userId: 'user_11111',          // Optional: User ID (defaults to site owner)
      additionalData: {              // Optional: Additional research parameters
        includeCompanyInfo: true,
        includeContactHistory: true,
        researchDepth: 'detailed'
      }
    };

    console.log('📋 Workflow Options:', JSON.stringify(workflowOptions, null, 2));

    // Start the workflow
    const handle = await client.workflow.start('leadResearchWorkflow', {
      args: [workflowOptions],
      taskQueue: 'default',
      workflowId: `lead-research-${workflowOptions.lead_id}-${Date.now()}`,
    });

    console.log(`🚀 Workflow started with ID: ${handle.workflowId}`);
    console.log('⏳ Waiting for workflow to complete...');

    // Wait for result
    const result = await handle.result();

    console.log('\n🎉 Lead Research Workflow Completed!');
    console.log('📊 Results:');
    console.log(`   ✅ Success: ${result.success}`);
    console.log(`   🔍 Lead ID: ${result.leadId}`);
    console.log(`   🏢 Site: ${result.siteName} (${result.siteUrl})`);
    console.log(`   ⏱️  Execution Time: ${result.executionTime}`);
    console.log(`   📅 Completed At: ${result.completedAt}`);

    if (result.insights && result.insights.length > 0) {
      console.log('\n🔍 Research Insights:');
      result.insights.forEach((insight, index) => {
        console.log(`   ${index + 1}. ${insight.title || insight.summary || insight.description || `Insight ${index + 1}`}`);
      });
    }

    if (result.recommendations && result.recommendations.length > 0) {
      console.log('\n💡 Recommendations:');
      result.recommendations.forEach((recommendation, index) => {
        console.log(`   ${index + 1}. ${recommendation}`);
      });
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

// Example: Using the workflow with different scenarios
async function runDifferentScenarios() {
  console.log('\n📝 Lead Research Workflow - Different Usage Scenarios\n');

  // Scenario 1: Basic lead research
  console.log('🔍 Scenario 1: Basic Lead Research');
  try {
    const basicOptions = {
      lead_id: 'lead_basic_001',
      site_id: 'site_demo_001'
    };
    console.log('Options:', basicOptions);
    // await runLeadResearchExample(basicOptions);
  } catch (error) {
    console.error('❌ Basic scenario failed:', error.message);
  }

  // Scenario 2: Detailed research with additional data
  console.log('\n🔍 Scenario 2: Detailed Research');
  try {
    const detailedOptions = {
      lead_id: 'lead_detailed_002',
      site_id: 'site_demo_002',
      userId: 'user_sales_manager',
      additionalData: {
        includeCompanyInfo: true,
        includeContactHistory: true,
        includeSocialMedia: true,
        researchDepth: 'comprehensive',
        focusAreas: ['technology', 'budget', 'decision_makers', 'social_networks']
      }
    };
    console.log('Options:', detailedOptions);
    // await runLeadResearchExample(detailedOptions);
  } catch (error) {
    console.error('❌ Detailed scenario failed:', error.message);
  }

  // Scenario 3: Quick research for high-volume leads
  console.log('\n🔍 Scenario 3: Quick Research');
  try {
    const quickOptions = {
      lead_id: 'lead_quick_003',
      site_id: 'site_demo_003',
      additionalData: {
        researchDepth: 'basic',
        timeLimit: '2 minutes',
        focusAreas: ['contact_info', 'company_size']
      }
    };
    console.log('Options:', quickOptions);
    // await runLeadResearchExample(quickOptions);
  } catch (error) {
    console.error('❌ Quick scenario failed:', error.message);
  }
}

// CLI usage
if (require.main === module) {
  console.log('🚀 Lead Research Workflow Example');
  console.log('=====================================\n');
  
  runLeadResearchExample()
    .then(() => {
      console.log('\n✅ Example completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Example failed:', error.message);
      process.exit(1);
    });
}

// Export for use in other modules
module.exports = {
  runLeadResearchExample,
  runDifferentScenarios
};

/*
Expected API Response Format:
{
  "success": true,
  "data": {
    "researchData": {
      "company": "Acme Corp",
      "industry": "Technology",
      "size": "50-100 employees",
      "revenue": "$5M-$10M",
      "location": "San Francisco, CA",
      "website": "https://acme.com",
      "contact": {
        "name": "John Doe",
        "title": "VP of Sales",
        "email": "john@acme.com",
        "phone": "+1-555-0123"
      }
    },
    "insights": [
      {
        "title": "Company Growth",
        "description": "Company has grown 50% YoY",
        "confidence": 0.85,
        "source": "LinkedIn analysis"
      },
      {
        "title": "Technology Stack",
        "description": "Uses modern web technologies",
        "confidence": 0.90,
        "source": "Website analysis"
      }
    ],
    "recommendations": [
      "Follow up within 24 hours",
      "Focus on scalability benefits",
      "Schedule demo for next week",
      "Connect on LinkedIn first"
    ]
  }
}
*/ 