#!/usr/bin/env ts-node

/**
 * Render Startup Script
 * This script starts the Temporal worker and initializes schedules on Render
 */

import { startWorker } from '../temporal/workers/worker';
import { createAllSchedules } from '../temporal/schedules';

async function startupRender() {
  console.log('🚀 RENDER STARTUP SCRIPT');
  console.log('========================');
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log(`Environment: ${process.env.NODE_ENV}`);
  console.log(`Platform: Render`);
  console.log('');

  try {
    // Validate environment first
    console.log('🔧 Validating environment...');
    if (!process.env.TEMPORAL_SERVER_URL) {
      throw new Error('TEMPORAL_SERVER_URL environment variable is required');
    }
    if (!process.env.TEMPORAL_NAMESPACE) {
      throw new Error('TEMPORAL_NAMESPACE environment variable is required');
    }

    console.log('✅ Environment validated successfully');
    console.log(`   - Server: ${process.env.TEMPORAL_SERVER_URL}`);
    console.log(`   - Namespace: ${process.env.TEMPORAL_NAMESPACE}`);
    console.log(`   - Task Queue: ${process.env.WORKFLOW_TASK_QUEUE || 'default'}`);
    console.log('');

    // Step 1: Start the Temporal worker
    console.log('👷 Step 1: Starting Temporal worker...');
    const workerPromise = startWorker();
    console.log('✅ Worker started successfully');
    console.log('');

    // Step 2: Wait a bit for worker to be fully ready
    console.log('⏳ Step 2: Waiting for worker to be ready...');
    await new Promise(resolve => setTimeout(resolve, 5000)); // 5 seconds
    console.log('✅ Worker ready');
    console.log('');

    const shouldInitializeSchedules =
      process.env.INITIALIZE_TEMPORAL_SCHEDULES !== 'false';

    if (!shouldInitializeSchedules) {
      console.log('⏭️ Step 3: Temporal schedule initialization disabled');
      console.log('');
    } else {
      // Step 3: Initialize schedules
      console.log('📅 Step 3: Creating Temporal schedules...');
      const result = await createAllSchedules();
      console.log('');

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
    }

    console.log('');
    console.log('✅ RENDER STARTUP COMPLETED');
    console.log('===========================');
    console.log(
      shouldInitializeSchedules
        ? '🔄 Worker is now running and schedules are active'
        : '🔄 Worker is now running without schedule initialization'
    );
    console.log('💡 Check Temporal UI to see your schedules and workflows');
    console.log('');

    // Keep the worker running
    await workerPromise;

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('');
    console.error('❌ RENDER STARTUP FAILED');
    console.error('========================');
    console.error('Error:', errorMessage);
    console.error('');
    
    if (error instanceof Error && error.stack) {
      console.error('Stack trace:');
      console.error(error.stack);
    }

    process.exit(1);
  }
}

// Handle process termination gracefully
process.on('SIGINT', () => {
  console.log('');
  console.log('🛑 Received SIGINT, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('');
  console.log('🛑 Received SIGTERM, shutting down gracefully...');
  process.exit(0);
});

// Run the startup script
if (require.main === module) {
  startupRender().catch((error) => {
    console.error('Startup script failed:', error);
    process.exit(1);
  });
}

export { startupRender }; 