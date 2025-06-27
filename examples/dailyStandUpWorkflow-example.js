#!/usr/bin/env node

/**
 * Example: Daily Stand Up Workflow
 * 
 * This example demonstrates how to use the dailyStandUpWorkflow
 * to execute a comprehensive CMO daily stand up analysis.
 * 
 * The workflow will:
 * 1. Analyze system status (settings, billing, etc.)
 * 2. Get sales summary from sales agent
 * 3. Analyze support tasks and conversations
 * 4. Review growth content and experiments
 * 5. Create a comprehensive wrap-up summary
 */

const { getTemporalClient } = require('../dist/temporal/client');

async function runDailyStandUpExample() {
  console.log('🎯 CMO Daily Stand Up Workflow Example');
  console.log('=====================================\n');

  try {
    // Get Temporal client
    const client = await getTemporalClient();
    console.log('✅ Connected to Temporal server\n');

    // Example 1: Sequential execution (default)
    console.log('📋 Example 1: Sequential Execution');
    console.log('----------------------------------');
    
    const sequentialOptions = {
      site_id: 'your-site-id-here',      // Replace with actual site ID
      userId: 'your-user-id-here',       // Replace with actual user ID
      runParallel: false,                // Run analyses sequentially
      additionalData: {
        requestedBy: 'cmo',
        priority: 'daily',
        includeRecommendations: true
      }
    };

    console.log('📊 Configuration:', JSON.stringify(sequentialOptions, null, 2));
    console.log('');

    const workflowId1 = `daily-standup-sequential-${Date.now()}`;
    
    const handle1 = await client.workflow.start('dailyStandUpWorkflow', {
      args: [sequentialOptions],
      taskQueue: 'default',
      workflowId: workflowId1,
    });

    console.log(`🚀 Started sequential workflow: ${workflowId1}`);
    console.log('⏳ Waiting for completion...\n');

    const result1 = await handle1.result();
    
    console.log('🎉 Sequential execution completed!');
    console.log(`📊 Success: ${result1.success}`);
    console.log(`🏢 Site: ${result1.siteName || 'Unknown'}`);
    console.log(`📋 Command ID: ${result1.command_id || 'N/A'}`);
    console.log(`⏱️ Execution Time: ${result1.executionTime}`);
    console.log(`❌ Errors: ${result1.errors.length}`);

    if (result1.errors.length > 0) {
      console.log('⚠️ Errors encountered:');
      result1.errors.forEach((error, i) => console.log(`   ${i + 1}. ${error}`));
    }

    console.log('\n📈 Analysis Results:');
    console.log(`   - System Analysis: ${result1.systemAnalysis?.success ? '✅' : '❌'}`);
    console.log(`   - Sales Analysis: ${result1.salesAnalysis?.success ? '✅' : '❌'}`);
    console.log(`   - Support Analysis: ${result1.supportAnalysis?.success ? '✅' : '❌'}`);
    console.log(`   - Growth Analysis: ${result1.growthAnalysis?.success ? '✅' : '❌'}`);

    if (result1.finalSummary) {
      console.log('\n📋 Final Summary Preview:');
      console.log(`"${result1.finalSummary.substring(0, 150)}..."`);
    }

    console.log('\n' + '='.repeat(50) + '\n');

    // Example 2: Parallel execution
    console.log('📋 Example 2: Parallel Execution');
    console.log('---------------------------------');
    
    const parallelOptions = {
      site_id: 'your-site-id-here',      // Replace with actual site ID
      userId: 'your-user-id-here',       // Replace with actual user ID
      runParallel: true,                 // Run analyses in parallel
      additionalData: {
        requestedBy: 'cmo',
        priority: 'urgent',
        fastMode: true
      }
    };

    console.log('📊 Configuration:', JSON.stringify(parallelOptions, null, 2));
    console.log('');

    const workflowId2 = `daily-standup-parallel-${Date.now()}`;
    
    const handle2 = await client.workflow.start('dailyStandUpWorkflow', {
      args: [parallelOptions],
      taskQueue: 'default',
      workflowId: workflowId2,
    });

    console.log(`🚀 Started parallel workflow: ${workflowId2}`);
    console.log('⏳ Waiting for completion...\n');

    const result2 = await handle2.result();
    
    console.log('🎉 Parallel execution completed!');
    console.log(`📊 Success: ${result2.success}`);
    console.log(`🏢 Site: ${result2.siteName || 'Unknown'}`);
    console.log(`📋 Command ID: ${result2.command_id || 'N/A'}`);
    console.log(`⏱️ Execution Time: ${result2.executionTime}`);
    console.log(`❌ Errors: ${result2.errors.length}`);

    console.log('\n📈 Analysis Results:');
    console.log(`   - System Analysis: ${result2.systemAnalysis?.success ? '✅' : '❌'}`);
    console.log(`   - Sales Analysis: ${result2.salesAnalysis?.success ? '✅' : '❌'}`);
    console.log(`   - Support Analysis: ${result2.supportAnalysis?.success ? '✅' : '❌'}`);
    console.log(`   - Growth Analysis: ${result2.growthAnalysis?.success ? '✅' : '❌'}`);

    console.log('\n🔍 Performance Comparison:');
    const seq_time = parseFloat(result1.executionTime);
    const par_time = parseFloat(result2.executionTime);
    console.log(`   - Sequential: ${result1.executionTime}`);
    console.log(`   - Parallel: ${result2.executionTime}`);
    if (!isNaN(seq_time) && !isNaN(par_time)) {
      const improvement = ((seq_time - par_time) / seq_time * 100).toFixed(1);
      console.log(`   - Performance improvement: ${improvement}% faster`);
    }

    console.log('\n✅ All examples completed successfully!');

  } catch (error) {
    console.error('❌ Example failed:', error);
    
    if (error.message && error.message.includes('connection')) {
      console.log('\n💡 Make sure Temporal server is running:');
      console.log('   - For local development: temporal server start-dev');
      console.log('   - Check connection settings in config.ts');
    }
    
    process.exit(1);
  }
}

// Usage instructions
function printUsageInstructions() {
  console.log('\n📚 Usage Instructions:');
  console.log('=====================\n');
  
  console.log('1. Replace site_id and userId with actual values');
  console.log('2. Ensure the CMO API routes are implemented:');
  console.log('   - POST /api/cmo/dailyStandUp/system');
  console.log('   - POST /api/cmo/dailyStandUp/sales');
  console.log('   - POST /api/cmo/dailyStandUp/support');
  console.log('   - POST /api/cmo/dailyStandUp/growth');
  console.log('   - POST /api/cmo/dailyStandUp/wrapUp');
  console.log('');
  console.log('3. Start the Temporal server:');
  console.log('   temporal server start-dev');
  console.log('');
  console.log('4. Start the worker:');
  console.log('   npm run worker');
  console.log('');
  console.log('5. Run this example:');
  console.log('   node examples/dailyStandUpWorkflow-example.js');
  console.log('');
  console.log('📋 Expected Workflow Flow:');
  console.log('1. System Analysis - Checks settings, billing, system health');
  console.log('2. Sales Analysis - Gets summary from sales agent');
  console.log('3. Support Analysis - Reviews tasks and conversations');
  console.log('4. Growth Analysis - Analyzes content and experiments');
  console.log('5. Wrap Up - Combines all memories into final summary');
  console.log('');
  console.log('All steps share the same command_id for memory continuity.');
}

// Run the example
if (require.main === module) {
  // Check if help was requested
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printUsageInstructions();
    process.exit(0);
  }

  runDailyStandUpExample()
    .then(() => {
      printUsageInstructions();
      console.log('\n🎯 Daily Stand Up Workflow example completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Daily Stand Up Workflow example failed:', error);
      printUsageInstructions();
      process.exit(1);
    });
}

module.exports = { runDailyStandUpExample }; 