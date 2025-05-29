#!/usr/bin/env ts-node

/**
 * Render Initialization Script
 * This script initializes Temporal schedules after deployment on Render
 */

import { createAllSchedules } from '../temporal/schedules';
import { logger } from '../lib/logger';

async function initializeRender() {
  console.log('🚀 RENDER INITIALIZATION SCRIPT');
  console.log('================================');
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log(`Environment: ${process.env.NODE_ENV}`);
  console.log(`Platform: Render`);
  console.log('');

  try {
    // Wait a bit for services to be fully ready
    console.log('⏳ Waiting for services to be ready...');
    await new Promise(resolve => setTimeout(resolve, 10000)); // 10 seconds

    // Validate environment
    if (!process.env.TEMPORAL_SERVER_URL) {
      throw new Error('TEMPORAL_SERVER_URL environment variable is required');
    }

    if (!process.env.TEMPORAL_NAMESPACE) {
      throw new Error('TEMPORAL_NAMESPACE environment variable is required');
    }

    console.log('🔧 Environment validated successfully');
    console.log(`   - Server: ${process.env.TEMPORAL_SERVER_URL}`);
    console.log(`   - Namespace: ${process.env.TEMPORAL_NAMESPACE}`);
    console.log(`   - Task Queue: ${process.env.WORKFLOW_TASK_QUEUE || 'default'}`);
    console.log('');

    // Create all default schedules
    console.log('📅 Creating Temporal schedules...');
    const result = await createAllSchedules();

    console.log('');
    console.log('✅ RENDER INITIALIZATION COMPLETED');
    console.log('=================================');
    console.log(`📊 Total schedules: ${result.total}`);
    console.log(`✅ Successful: ${result.success.length}`);
    console.log(`❌ Failed: ${result.failed.length}`);

    if (result.success.length > 0) {
      console.log('');
      console.log('📋 Successfully created schedules:');
      result.success.forEach(id => {
        console.log(`   ✅ ${id}`);
      });
    }

    if (result.failed.length > 0) {
      console.log('');
      console.log('❌ Failed schedules:');
      result.failed.forEach(({ id, error }) => {
        console.log(`   ❌ ${id}: ${error}`);
      });
    }

    console.log('');
    console.log('🎯 Next Steps:');
    console.log('   1. Check Temporal UI to verify schedules');
    console.log('   2. Monitor worker logs for schedule executions');
    console.log('   3. Schedules will run according to their cron expressions');
    console.log('');

    // Exit successfully
    process.exit(0);

  } catch (error) {
    logger.error('💥 Render initialization failed', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });

    console.error('');
    console.error('❌ RENDER INITIALIZATION FAILED');
    console.error('===============================');
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    console.error('');
    console.error('🔧 Troubleshooting:');
    console.error('   1. Verify environment variables are set correctly');
    console.error('   2. Check Temporal server connectivity');
    console.error('   3. Ensure worker is running and healthy');
    console.error('   4. Review deployment logs for errors');

    process.exit(1);
  }
}

// Run initialization if this script is executed directly
if (require.main === module) {
  initializeRender();
}

export { initializeRender }; 