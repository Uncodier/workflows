#!/usr/bin/env node
import { createSchedule, defaultSchedules } from '../temporal/schedules';

async function createAllSchedules() {
  console.log('=== CREATE ALL SCHEDULES SCRIPT STARTED ===');
  console.log('Timestamp:', new Date().toISOString());
  console.log('Environment:', {
    NODE_ENV: process.env.NODE_ENV,
    TEMPORAL_SERVER_URL: process.env.TEMPORAL_SERVER_URL ? 'SET' : 'NOT_SET',
    TEMPORAL_NAMESPACE: process.env.TEMPORAL_NAMESPACE || 'default',
    TEMPORAL_API_KEY: process.env.TEMPORAL_API_KEY ? 'SET' : 'NOT_SET',
    TEMPORAL_TLS: process.env.TEMPORAL_TLS,
    WORKFLOW_TASK_QUEUE: process.env.WORKFLOW_TASK_QUEUE || 'default',
    PWD: process.cwd()
  });
  
  console.log('');
  console.log(`🚀 Creating ${defaultSchedules.length} schedules...`);
  console.log('Default schedules to create:', defaultSchedules.map(s => ({
    id: s.id,
    workflowType: s.workflowType,
    cronSchedule: s.cronSchedule
  })));
  console.log('');

  const results = {
    success: [] as string[],
    failed: [] as { id: string; error: string }[]
  };

  for (const schedule of defaultSchedules) {
    try {
      console.log(`📅 Creating schedule: ${schedule.id}`);
      console.log(`   - Workflow: ${schedule.workflowType}`);
      console.log(`   - Cron: ${schedule.cronSchedule}`);
      console.log(`   - Description: ${schedule.description}`);
      console.log(`   - Full schedule config:`, JSON.stringify(schedule, null, 2));
      
      console.log(`   🔄 Calling createSchedule function...`);
      const result = await createSchedule(schedule);
      console.log(`   📋 CreateSchedule result:`, result);
      console.log(`   ✅ ${result.message}`);
      console.log('');
      
      results.success.push(schedule.id);
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log(`   ❌ Failed: ${errorMessage}`);
      console.log(`   🔍 Error details:`, {
        name: error instanceof Error ? error.name : 'Unknown',
        stack: error instanceof Error ? error.stack : 'No stack trace',
        errorType: typeof error,
        errorConstructor: error instanceof Error ? error.constructor.name : 'Unknown'
      });
      console.log('');
      
      results.failed.push({
        id: schedule.id,
        error: errorMessage
      });
    }
  }

  // Summary
  console.log('=== SCHEDULE CREATION SUMMARY ===');
  console.log(`✅ Successfully created: ${results.success.length} schedules`);
  if (results.success.length > 0) {
    results.success.forEach(id => console.log(`   - ${id}`));
  }
  
  console.log(`❌ Failed to create: ${results.failed.length} schedules`);
  if (results.failed.length > 0) {
    results.failed.forEach(({ id, error }) => console.log(`   - ${id}: ${error}`));
  }

  console.log('');
  console.log('🔍 Check Temporal UI to see your schedules');
  console.log('📋 Use "npm run schedule:list" to list all schedules');
  console.log('=== CREATE ALL SCHEDULES SCRIPT COMPLETED ===');
  
  if (results.failed.length > 0) {
    console.log('❌ Exiting with error code 1 due to failed schedules');
    process.exit(1);
  } else {
    console.log('✅ All schedules created successfully');
  }
}

// Run the script if called directly
if (require.main === module) {
  console.log('=== SCRIPT EXECUTION STARTED ===');
  console.log('Module info:', {
    filename: __filename,
    isMain: require.main === module,
    nodeVersion: process.version
  });
  
  createAllSchedules().catch((error) => {
    console.error('=== FATAL ERROR IN CREATE ALL SCHEDULES ===');
    console.error('💥 Fatal error:', {
      message: error.message,
      name: error.name,
      stack: error.stack,
      errorType: typeof error
    });
    process.exit(1);
  });
} else {
  console.log('=== SCRIPT IMPORTED AS MODULE ===');
}

export { createAllSchedules }; 