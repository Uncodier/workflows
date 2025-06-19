/**
 * Deep Research Workflow Example
 * 
 * This example demonstrates how to use the deepResearchWorkflow to perform
 * comprehensive data analysis research using the dataAnalyst agent.
 * 
 * The workflow performs the following steps:
 * 1. Calls /api/agents/dataAnalyst/deepResearch to generate research operations
 * 2. Executes each operation via /api/agents/dataAnalyst/search
 * 3. Performs final analysis via /api/agents/dataAnalyst/analysis
 */

const { getTemporalClient } = require('../src/temporal/client');
const { deepResearchWorkflow } = require('../src/temporal/workflows/deepResearchWorkflow');

async function runDeepResearchExample() {
  try {
    console.log('🔬 Deep Research Workflow Example');
    console.log('================================');

    // Configuration for the deep research
    const researchOptions = {
      site_id: 'your-site-id',                    // Replace with actual site ID
      research_topic: 'Competitor analysis for AI tools',  // The research topic
      userId: 'your-user-id',                     // Replace with actual user ID
      additionalData: {
        // Optional additional configuration
        depth: 'comprehensive',                   // Research depth level
        focus_areas: [                           // Areas to focus on
          'pricing strategies',
          'feature comparison',
          'market positioning',
          'customer feedback'
        ],
        time_horizon: '6 months',                // Time scope for research
        target_market: 'B2B SaaS'               // Target market segment
      }
    };

    console.log('📋 Research Configuration:');
    console.log(JSON.stringify(researchOptions, null, 2));
    console.log('');

    // Get Temporal client and start workflow
    const client = await getTemporalClient();
    const workflowId = `deep-research-example-${Date.now()}`;

    console.log(`🚀 Starting workflow with ID: ${workflowId}`);
    
    const handle = await client.workflow.start(deepResearchWorkflow, {
      workflowId,
      taskQueue: 'workflows',
      args: [researchOptions],
    });

    console.log('⏳ Waiting for research completion...');
    
    // Wait for the workflow to complete
    const result = await handle.result();

    console.log('');
    console.log('🎉 Deep Research Completed!');
    console.log('===========================');
    console.log(`✅ Success: ${result.success}`);
    console.log(`🏢 Site: ${result.siteName || 'Unknown'}`);
    console.log(`🔬 Research Topic: ${result.researchTopic}`);
    console.log(`⚙️ Operations Executed: ${result.operationResults?.length || 0}`);
    console.log(`🔍 Insights Generated: ${result.insights?.length || 0}`);
    console.log(`💡 Recommendations: ${result.recommendations?.length || 0}`);
    console.log(`⏱️ Execution Time: ${result.executionTime}`);

    // Display key insights
    if (result.insights && result.insights.length > 0) {
      console.log('');
      console.log('🔍 Key Insights:');
      result.insights.slice(0, 5).forEach((insight, index) => {
        const text = typeof insight === 'string' ? insight : 
                    insight.text || insight.description || JSON.stringify(insight);
        console.log(`   ${index + 1}. ${text.substring(0, 150)}${text.length > 150 ? '...' : ''}`);
      });
    }

    // Display recommendations
    if (result.recommendations && result.recommendations.length > 0) {
      console.log('');
      console.log('💡 Recommendations:');
      result.recommendations.slice(0, 5).forEach((rec, index) => {
        const text = typeof rec === 'string' ? rec : 
                    rec.text || rec.description || JSON.stringify(rec);
        console.log(`   ${index + 1}. ${text.substring(0, 150)}${text.length > 150 ? '...' : ''}`);
      });
    }

    // Display any errors or warnings
    if (result.errors && result.errors.length > 0) {
      console.log('');
      console.log('⚠️ Warnings/Issues:');
      result.errors.forEach((error, index) => {
        console.log(`   ${index + 1}. ${error}`);
      });
    }

    console.log('');
    console.log('✅ Example completed successfully!');
    
  } catch (error) {
    console.error('❌ Error running deep research example:');
    console.error(error);
    process.exit(1);
  }
}

// Example usage patterns
console.log('Deep Research Workflow - Usage Examples');
console.log('======================================');
console.log('');
console.log('1. Market Research:');
console.log('   research_topic: "Market analysis for CRM software"');
console.log('   focus_areas: ["competitors", "pricing", "features"]');
console.log('');
console.log('2. Competitive Intelligence:');
console.log('   research_topic: "Competitor feature comparison"');
console.log('   focus_areas: ["product features", "pricing models", "customer reviews"]');
console.log('');
console.log('3. Industry Analysis:');
console.log('   research_topic: "AI tools market trends 2024"');
console.log('   focus_areas: ["market trends", "emerging technologies", "investment patterns"]');
console.log('');

// Run the example if this file is executed directly
if (require.main === module) {
  runDeepResearchExample().catch(console.error);
}

module.exports = {
  runDeepResearchExample,
  deepResearchWorkflow
}; 