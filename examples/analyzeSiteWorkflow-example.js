/**
 * Example: Analyze Site Workflow
 * This example shows how to use the analyzeSiteWorkflow to analyze a website with UX agents
 */

const { getTemporalClient } = require('../src/temporal/client');
const { analyzeSiteWorkflow } = require('../src/temporal/workflows/analyzeSiteWorkflow');

async function runAnalyzeSiteWorkflow() {
  console.log('🔍 Starting Analyze Site Workflow Example...');
  
  try {
    // Get Temporal client
    const client = await getTemporalClient();
    
    // Example site ID - replace with your actual site ID
    const siteId = 'example-site-123';
    
    // Workflow options
    const options = {
      site_id: siteId,
      userId: 'user-123',
      additionalData: {
        analysisType: 'full',
        priority: 'high',
        source: 'manual_trigger'
      }
    };
    
    console.log(`📝 Analyzing site: ${siteId}`);
    console.log(`📋 Options:`, JSON.stringify(options, null, 2));
    
    // Generate unique workflow ID
    const workflowId = `analyze-site-${siteId}-${Date.now()}`;
    
    // Start the workflow
    const handle = await client.workflow.start(analyzeSiteWorkflow, {
      args: [options],
      taskQueue: 'default',
      workflowId: workflowId,
    });
    
    console.log(`🚀 Workflow started with ID: ${handle.workflowId}`);
    
    // Wait for completion
    console.log('⏳ Waiting for workflow to complete...');
    const result = await handle.result();
    
    console.log('\n🎉 Analysis completed!');
    console.log('📊 Results Summary:');
    console.log(`   - Success: ${result.success}`);
    console.log(`   - Site: ${result.siteName || 'N/A'} (${result.siteUrl || 'N/A'})`);
    console.log(`   - UX Analysis: ${result.analysisResult?.success ? '✅' : '❌'}`);
    console.log(`   - UX Assimilate: ${result.assimilateResult?.success ? '✅' : '❌'}`);
    console.log(`   - UX Experiments: ${result.experimentsResult?.success ? '✅' : '❌'}`);
    console.log(`   - Execution Time: ${result.executionTime}`);
    
    if (result.errors.length > 0) {
      console.log('\n⚠️ Errors:');
      result.errors.forEach((error, index) => {
        console.log(`   ${index + 1}. ${error}`);
      });
    }
    
    // Example: Access specific results
    if (result.analysisResult?.data) {
      console.log('\n🔍 UX Analysis Data Available');
      // Process analysis data here
    }
    
    if (result.assimilateResult?.data) {
      console.log('🧠 UX Assimilate Data Available');
      // Process assimilate data here
    }
    
    if (result.experimentsResult?.data) {
      console.log('🧪 UX Experiments Data Available');
      // Process experiments data here
    }
    
    return result;
    
  } catch (error) {
    console.error('❌ Workflow failed:', error);
    throw error;
  }
}

// Example usage patterns
async function exampleUsage() {
  console.log('\n📚 Analyze Site Workflow Usage Examples:\n');
  
  // Example 1: Basic usage
  console.log('1. Basic Site Analysis:');
  console.log(`
    const result = await analyzeSiteWorkflow({
      site_id: 'your-site-id',
      userId: 'user-123'
    });
  `);
  
  // Example 2: With additional data
  console.log('2. Advanced Analysis with Custom Data:');
  console.log(`
    const result = await analyzeSiteWorkflow({
      site_id: 'your-site-id',
      userId: 'user-123',
      additionalData: {
        analysisType: 'conversion_focused',
        target_audience: 'mobile_users',
        business_goals: ['increase_conversions', 'reduce_bounce_rate'],
        custom_metrics: ['page_load_time', 'cta_visibility']
      }
    });
  `);
  
  // Example 3: Processing results
  console.log('3. Processing Results:');
  console.log(`
    const result = await analyzeSiteWorkflow(options);
    
    if (result.success) {
      // Process UX analysis results
      const analysisInsights = result.analysisResult?.data?.insights || [];
      
      // Process assimilation results
      const processedData = result.assimilateResult?.data?.processed_data || {};
      
      // Process experiment suggestions
      const experiments = result.experimentsResult?.data?.experiments || [];
      
      console.log('Analysis Insights:', analysisInsights);
      console.log('Processed Data:', processedData);
      console.log('Suggested Experiments:', experiments);
    }
  `);
}

// Run the example if this file is executed directly
if (require.main === module) {
  runAnalyzeSiteWorkflow()
    .then(() => {
      console.log('\n✅ Example completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Example failed:', error);
      process.exit(1);
    });
}

module.exports = {
  runAnalyzeSiteWorkflow,
  exampleUsage
}; 