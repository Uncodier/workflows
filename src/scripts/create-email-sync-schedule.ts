#!/usr/bin/env node
import { createSchedule, defaultSchedules } from '../temporal/schedules';

async function createEmailSyncSchedule() {
  try {
    // Find the email sync schedule from our default schedules
    const emailSyncSchedule = defaultSchedules.find(schedule => schedule.id === 'sync-emails-schedule-manager');
    
    if (!emailSyncSchedule) {
      console.error('Email sync schedule not found in default schedules');
      process.exit(1);
    }

    console.log('Creating email sync schedule...');
    console.log(`Schedule ID: ${emailSyncSchedule.id}`);
    console.log(`Workflow Type: ${emailSyncSchedule.workflowType}`);
    console.log(`Interval: Every ${emailSyncSchedule.intervalMinutes} minutes`);
    console.log(`Description: ${emailSyncSchedule.description}`);
    
    const result = await createSchedule(emailSyncSchedule);
    console.log('✅ Schedule created successfully:', result.message);
    console.log('🔍 Check Temporal UI to see it running every 5 minutes');
    
  } catch (error) {
    console.error('❌ Failed to create email sync schedule:', error);
    process.exit(1);
  }
}

// Run the script if called directly
if (require.main === module) {
  createEmailSyncSchedule();
} 