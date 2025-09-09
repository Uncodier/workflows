#!/usr/bin/env node
"use strict";
require('dotenv/config');
const { startWorker } = require('../temporal/workers/worker');
const { logger } = require('../lib/logger');
// Log environment info
console.log('=== Start Worker Script Initiated ===');
// Log version information
const WORKER_VERSION = 'v2.2-email-validation-version-bump';
console.log(`🚀 Worker starting with version: ${WORKER_VERSION}`);
logger.info(`Worker version: ${WORKER_VERSION}`);
logger.info('Starting Temporal worker...');
logger.debug('Environment configuration', {
    temporalServer: process.env.TEMPORAL_SERVER_URL,
    namespace: process.env.TEMPORAL_NAMESPACE,
    taskQueue: process.env.WORKFLOW_TASK_QUEUE,
    nodeEnv: process.env.NODE_ENV,
    isVercel: !!process.env.VERCEL,
    temporalTls: process.env.TEMPORAL_TLS,
    hasApiKey: !!process.env.TEMPORAL_API_KEY
});
// Validate critical environment variables
const requiredEnvVars = ['TEMPORAL_SERVER_URL', 'TEMPORAL_NAMESPACE'];
const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
if (missingVars.length > 0) {
    console.error('=== Missing required environment variables ===');
    console.error('Missing variables:', missingVars);
    console.error('Available env vars:', Object.keys(process.env).filter(key => key.startsWith('TEMPORAL')));
    if (!process.env.VERCEL) {
        process.exit(1);
    }
    else {
        throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
    }
}
// Handle Vercel serverless environment
async function run() {
    const startTime = Date.now();
    try {
        console.log('=== Attempting to start worker ===');
        logger.info('Calling startWorker function...');
        const worker = await startWorker();
        const duration = Date.now() - startTime;
        console.log('=== Worker startup completed ===');
        logger.info('Worker startup completed', {
            duration: duration,
            workerType: typeof worker,
            hasWorker: !!(worker && worker.worker),
            hasRunPromise: !!(worker && worker.runPromise),
            hasShutdown: !!(worker && worker.shutdown)
        });
        // Handle different environments
        if (process.env.VERCEL || process.env.NODE_ENV === 'production') {
            logger.info('Running in serverless environment (Vercel).');
            // In serverless, we return the worker instance but don't keep the process alive
            if (worker && worker.runPromise) {
                logger.info('Worker started successfully in serverless mode');
                // Don't await the runPromise in serverless - let it run in background
                return worker;
            }
            else if (worker) {
                logger.info('Worker started in serverless mode (no runPromise)');
                return worker;
            }
            else {
                logger.warn('Worker returned but no valid instance found');
                return worker;
            }
        }
        else {
            logger.info('Running in development mode. Worker will keep running.');
            // In development, await the runPromise to keep the process alive
            if (worker && worker.runPromise) {
                logger.info('Awaiting worker to keep process alive...');
                await worker.runPromise;
            }
        }
        // Handle graceful shutdown only in non-serverless environments
        if (!process.env.VERCEL) {
            process.on('SIGINT', async () => {
                logger.info('Shutting down worker...');
                if (worker && worker.shutdown) {
                    await worker.shutdown();
                }
                else if (worker && typeof worker.shutdown === 'function') {
                    await worker.shutdown();
                }
                process.exit(0);
            });
        }
        return worker;
    }
    catch (err) {
        const duration = Date.now() - startTime;
        console.error('=== Worker startup failed ===');
        logger.error('Worker startup failed', {
            error: err.message,
            stack: err.stack,
            duration: duration,
            errorName: err.name,
            errorCode: err.code
        });
        // Log additional context for debugging
        console.error('Additional context:', {
            cwd: process.cwd(),
            nodeVersion: process.version,
            platform: process.platform,
            arch: process.arch,
            memoryUsage: process.memoryUsage(),
            uptime: process.uptime()
        });
        // In serverless environments, don't exit the process - just throw
        if (process.env.VERCEL || process.env.NODE_ENV === 'production') {
            throw err;
        }
        else {
            process.exit(1);
        }
    }
}
// Only run if this is the main module
if (require.main === module) {
    console.log('=== Running as main module ===');
    run().catch((err) => {
        console.error('=== Failed to start worker process ===');
        logger.error('Failed to start worker process', {
            error: err.message,
            stack: err.stack
        });
        if (!process.env.VERCEL) {
            process.exit(1);
        }
    });
}
else {
    console.log('=== Running as imported module ===');
}
// Export the run function for use in serverless environments
module.exports = { run, startWorker };
