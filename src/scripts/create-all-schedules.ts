#!/usr/bin/env node

import { createAllSchedules } from '../temporal/schedules';

async function main() {
  console.log('🚀 Starting schedule creation...');
  console.log('Process info:', {
    pid: process.pid,
    platform: process.platform,
    nodeVersion: process.version,
    memoryUsage: process.memoryUsage(),
    uptime: process.uptime(),
    isVercel: !!process.env.VERCEL,
    vercelEnv: process.env.VERCEL_ENV,
    vercelRegion: process.env.VERCEL_REGION
  });
  
  try {
    const result = await createAllSchedules();
    
    console.log('');
    console.log('🎉 SCHEDULE CREATION COMPLETED!');
    console.log('Final result:', result);
    
    if (result.failed.length > 0) {
      console.log('⚠️  Some schedules failed to create. Check logs above for details.');
      process.exit(1);
    } else {
      console.log('✅ All schedules created successfully!');
      process.exit(0);
    }
    
  } catch (error) {
    console.error('💥 FATAL ERROR in schedule creation:');
    console.error('Error message:', error instanceof Error ? error.message : String(error));
    console.error('Error name:', error instanceof Error ? error.name : 'Unknown');
    console.error('Error stack:', error instanceof Error ? error.stack : 'No stack trace');
    console.error('Error type:', typeof error);
    
    console.log('');
    console.log('🔍 Environment debug info:');
    console.log('- TEMPORAL_SERVER_URL:', process.env.TEMPORAL_SERVER_URL ? 'SET' : 'NOT_SET');
    console.log('- TEMPORAL_NAMESPACE:', process.env.TEMPORAL_NAMESPACE || 'default');
    console.log('- TEMPORAL_API_KEY:', process.env.TEMPORAL_API_KEY ? 'SET' : 'NOT_SET');
    console.log('- TEMPORAL_TLS:', process.env.TEMPORAL_TLS);
    console.log('- WORKFLOW_TASK_QUEUE:', process.env.WORKFLOW_TASK_QUEUE || 'default');
    console.log('- NODE_ENV:', process.env.NODE_ENV);
    console.log('- PWD:', process.cwd());
    
    process.exit(1);
  }
}

// Handle process signals
process.on('SIGTERM', () => {
  console.log('🛑 Received SIGTERM, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('🛑 Received SIGINT, shutting down gracefully...');
  process.exit(0);
});

process.on('uncaughtException', (error) => {
  console.error('💥 Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

main().catch((error) => {
  console.error('💥 Main function failed:', error);
  process.exit(1);
}); 