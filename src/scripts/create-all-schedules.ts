#!/usr/bin/env node
import { createSchedule, defaultSchedules } from '../temporal/schedules';

async function createAllSchedules() {
  console.log(`🚀 Creating ${defaultSchedules.length} schedules...`);
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
      
      const result = await createSchedule(schedule);
      console.log(`   ✅ ${result.message}`);
      console.log('');
      
      results.success.push(schedule.id);
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log(`   ❌ Failed: ${errorMessage}`);
      console.log('');
      
      results.failed.push({
        id: schedule.id,
        error: errorMessage
      });
    }
  }

  // Summary
  console.log('📊 Summary:');
  console.log(`✅ Successfully created: ${results.success.length} schedules`);
  if (results.success.length > 0) {
    results.success.forEach(id => console.log(`   - ${id}`));
  }
  
  console.log(`❌ Failed to create: ${results.failed.length} schedules`);
  if (results.failed.length > 0) {
    results.failed.forEach(({ id, error }) => console.log(`   - ${id}: ${error}`));
  }

  console.log('');
  console.log('🔍 Check Temporal UI at http://localhost:8233 to see your schedules');
  console.log('📋 Use "npm run schedule:list" to list all schedules');
  
  if (results.failed.length > 0) {
    process.exit(1);
  }
}

// Run the script if called directly
if (require.main === module) {
  createAllSchedules().catch((error) => {
    console.error('💥 Fatal error:', error);
    process.exit(1);
  });
} 