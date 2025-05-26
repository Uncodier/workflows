#!/usr/bin/env node
require('dotenv/config');
const { startWorker } = require('../temporal/workers/worker');
const { logger } = require('../lib/logger');

// Log environment info
logger.info('Starting Temporal worker...');
logger.debug('Environment configuration', {
  temporalServer: process.env.TEMPORAL_SERVER_URL,
  namespace: process.env.TEMPORAL_NAMESPACE,
  taskQueue: process.env.WORKFLOW_TASK_QUEUE,
  nodeEnv: process.env.NODE_ENV
});

// Handle Vercel serverless environment
async function run() {
  try {
    const worker = await startWorker();
    
    // Keep the process alive in development
    if (process.env.NODE_ENV !== 'production') {
      logger.info('Running in development mode. Worker will keep running.');
      // Process will stay alive as long as worker is running
    } else {
      logger.info('Running in production mode on Vercel.');
      // In production on Vercel, the serverless function will stay active
      // as long as there are events to process
    }
    
    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      logger.info('Shutting down worker...');
      await worker.shutdown();
      process.exit(0);
    });
    
    return worker;
  } catch (err) {
    logger.error('Worker startup failed', { error: err });
    process.exit(1);
  }
}

run(); 