import { NativeConnection, Worker as TemporalWorker } from '@temporalio/worker';
import { activities } from '../activities';
import { logger } from '../../lib/logger';
import { temporalConfig } from '../../config/config';
import * as workflows from '../workflows/worker-workflows';

/**
 * Start a Temporal worker
 */
export async function startWorker() {
  try {
    logger.info('Starting Temporal worker...');

    // Validate required environment variables
    if (!temporalConfig.serverUrl) {
      throw new Error('TEMPORAL_SERVER_URL is required');
    }

    if (!temporalConfig.namespace) {
      throw new Error('TEMPORAL_NAMESPACE is required');
    }

    // Log configuration for debugging
    logger.info('Temporal configuration:', {
      serverUrl: temporalConfig.serverUrl,
      namespace: temporalConfig.namespace,
      taskQueue: temporalConfig.taskQueue,
      tls: temporalConfig.tls,
      hasApiKey: !!temporalConfig.apiKey
    });

    // Log available activities and workflows for debugging
    logger.info('Available activities:', { activities: Object.keys(activities) });
    logger.info('Available workflows:', { workflows: Object.keys(workflows) });

    // Connect to Temporal server
    const connectionOptions: any = {
      address: temporalConfig.serverUrl,
    };

    // Add TLS and API key for remote connections (Temporal Cloud)
    if (temporalConfig.tls) {
      connectionOptions.tls = {};
    }

    if (temporalConfig.apiKey) {
      connectionOptions.metadata = {
        'temporal-namespace': temporalConfig.namespace,
      };
      connectionOptions.apiKey = temporalConfig.apiKey;
    }

    logger.info('Attempting to connect to Temporal server...');
    const connection = await NativeConnection.connect(connectionOptions);
    logger.info('Successfully connected to Temporal server');

    // Create worker with all activities
    logger.info('Creating Temporal worker...');
    const worker = await TemporalWorker.create({
      connection,
      namespace: temporalConfig.namespace,
      taskQueue: temporalConfig.taskQueue,
      workflowsPath: require.resolve('../workflows/worker-workflows'),
      activities,
    });

    logger.info('Worker created successfully, starting to run...');

    // In serverless environments, we need to handle the worker differently
    if (process.env.VERCEL || process.env.NODE_ENV === 'production') {
      logger.info('Running in serverless environment');
      
      // Start worker but don't await indefinitely
      const runPromise = worker.run();
      
      // Set up graceful shutdown
      const shutdown = async () => {
        logger.info('Shutting down worker...');
        await worker.shutdown();
      };

      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
      
      // Return worker instance for management
      return { worker, runPromise, shutdown };
    } else {
      // In development, run normally
      await worker.run();
      logger.info('Worker started successfully', { taskQueue: temporalConfig.taskQueue });
      return worker;
    }
    
  } catch (error: any) {
    logger.error('Failed to start worker', { 
      error: error.message,
      stack: error.stack,
      config: {
        serverUrl: temporalConfig.serverUrl,
        namespace: temporalConfig.namespace,
        taskQueue: temporalConfig.taskQueue
      }
    });
    
    // In serverless environments, don't exit the process
    if (process.env.VERCEL || process.env.NODE_ENV === 'production') {
      throw error;
    } else {
      process.exit(1);
    }
  }
}

if (require.main === module) {
  startWorker().catch((err) => {
    console.error('Worker startup failed:', err);
    process.exit(1);
  });
}

module.exports = { startWorker }; 