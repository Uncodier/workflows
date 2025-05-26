import { NativeConnection, Worker as TemporalWorker } from '@temporalio/worker';
import { activities } from '../activities';
import { logger } from '../../lib/logger';
import { temporalConfig } from '../../config/config';
import * as workflows from '../workflows/worker-workflows';

/**
 * Start a Temporal worker
 */
export async function startWorker() {
  const startTime = Date.now();
  
  try {
    console.log('=== Worker.ts: Starting Temporal worker ===');
    logger.info('Starting Temporal worker...');

    // Validate required environment variables
    console.log('=== Validating configuration ===');
    if (!temporalConfig.serverUrl) {
      throw new Error('TEMPORAL_SERVER_URL is required');
    }

    if (!temporalConfig.namespace) {
      throw new Error('TEMPORAL_NAMESPACE is required');
    }

    // Log configuration for debugging
    console.log('=== Temporal configuration ===');
    logger.info('Temporal configuration:', {
      serverUrl: temporalConfig.serverUrl,
      namespace: temporalConfig.namespace,
      taskQueue: temporalConfig.taskQueue,
      tls: temporalConfig.tls,
      hasApiKey: !!temporalConfig.apiKey
    });

    // Check activities and workflows
    console.log('=== Checking activities and workflows ===');
    try {
      const activityKeys = Object.keys(activities);
      const workflowKeys = Object.keys(workflows);
      
      logger.info('Available activities:', { activities: activityKeys, count: activityKeys.length });
      logger.info('Available workflows:', { workflows: workflowKeys, count: workflowKeys.length });
      
      if (activityKeys.length === 0) {
        logger.warn('No activities found - this might cause issues');
      }
      
      if (workflowKeys.length === 0) {
        logger.warn('No workflows found - this might cause issues');
      }
    } catch (activityError: any) {
      logger.error('Error checking activities/workflows:', { error: activityError.message });
      throw new Error(`Failed to load activities/workflows: ${activityError.message}`);
    }

    // Connect to Temporal server
    console.log('=== Preparing connection options ===');
    const connectionOptions: any = {
      address: temporalConfig.serverUrl,
    };

    // Add TLS and API key for remote connections (Temporal Cloud)
    if (temporalConfig.tls) {
      connectionOptions.tls = {};
      logger.info('TLS enabled for connection');
    }

    if (temporalConfig.apiKey) {
      connectionOptions.metadata = {
        'temporal-namespace': temporalConfig.namespace,
      };
      connectionOptions.apiKey = temporalConfig.apiKey;
      logger.info('API key configured for Temporal Cloud');
    }

    logger.info('Connection options prepared:', {
      address: connectionOptions.address,
      hasTls: !!connectionOptions.tls,
      hasApiKey: !!connectionOptions.apiKey,
      hasMetadata: !!connectionOptions.metadata
    });

    console.log('=== Attempting to connect to Temporal server ===');
    logger.info('Attempting to connect to Temporal server...');
    
    const connectionStart = Date.now();
    const connection = await NativeConnection.connect(connectionOptions);
    const connectionDuration = Date.now() - connectionStart;
    
    console.log('=== Successfully connected to Temporal server ===');
    logger.info('Successfully connected to Temporal server', {
      duration: connectionDuration,
      connectionType: typeof connection
    });

    // Create worker with explicit activities
    console.log('=== Creating Temporal worker ===');
    logger.info('Creating Temporal worker...');
    
    const workerStart = Date.now();
    const worker = await TemporalWorker.create({
      connection,
      namespace: temporalConfig.namespace,
      taskQueue: temporalConfig.taskQueue,
      workflowsPath: require.resolve('../workflows/worker-workflows'),
      activities: {
        fetchDataActivity: activities.fetchDataActivity,
        createResourceActivity: activities.createResourceActivity,
        updateResourceActivity: activities.updateResourceActivity,
        deleteResourceActivity: activities.deleteResourceActivity,
        logWorkflowExecutionActivity: activities.logWorkflowExecutionActivity,
        storeWorkflowResultActivity: activities.storeWorkflowResultActivity,
        fetchConfigurationActivity: activities.fetchConfigurationActivity,
        trackApiCallActivity: activities.trackApiCallActivity,
      },
    });
    const workerDuration = Date.now() - workerStart;

    console.log('=== Worker created successfully ===');
    logger.info('Worker created successfully, starting to run...', {
      duration: workerDuration,
      workerType: typeof worker
    });

    // In serverless environments, we need to handle the worker differently
    if (process.env.VERCEL || process.env.NODE_ENV === 'production') {
      console.log('=== Running in serverless environment ===');
      logger.info('Running in serverless environment');
      
      // Start worker but don't await indefinitely
      console.log('=== Starting worker.run() in background ===');
      const runPromise = worker.run();
      
      // Set up graceful shutdown
      const shutdown = async () => {
        console.log('=== Shutting down worker ===');
        logger.info('Shutting down worker...');
        await worker.shutdown();
      };

      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
      
      const totalDuration = Date.now() - startTime;
      console.log('=== Worker setup completed for serverless ===');
      logger.info('Worker setup completed for serverless', {
        totalDuration: totalDuration
      });
      
      // Return worker instance for management
      return { worker, runPromise, shutdown };
    } else {
      // In development, run normally
      console.log('=== Running worker in development mode ===');
      await worker.run();
      logger.info('Worker started successfully', { taskQueue: temporalConfig.taskQueue });
      return worker;
    }
    
  } catch (error: any) {
    const totalDuration = Date.now() - startTime;
    
    console.error('=== Worker startup failed ===');
    logger.error('Failed to start worker', { 
      error: error.message,
      stack: error.stack,
      duration: totalDuration,
      errorName: error.name,
      errorCode: error.code,
      config: {
        serverUrl: temporalConfig.serverUrl,
        namespace: temporalConfig.namespace,
        taskQueue: temporalConfig.taskQueue
      }
    });
    
    // Log additional debugging info
    console.error('Error context:', {
      errorType: typeof error,
      errorConstructor: error.constructor.name,
      hasMessage: !!error.message,
      hasStack: !!error.stack,
      hasCode: !!error.code,
      errorKeys: Object.keys(error)
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
  console.log('=== Worker.ts running as main module ===');
  startWorker().catch((err) => {
    console.error('Worker startup failed:', err);
    process.exit(1);
  });
}

module.exports = { startWorker }; 