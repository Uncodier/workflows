import { NativeConnection, Worker as TemporalWorker } from '@temporalio/worker';
import { activities } from '../activities';
import { logger } from '../../lib/logger';
import { temporalConfig } from '../../config/config';
import * as workflows from '../workflows/worker-workflows';

/**
 * Start a Temporal worker for Render deployment
 */
export async function startWorker() {
  try {
    logger.info('🚀 Starting Temporal worker on Render...');

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
      hasApiKey: !!temporalConfig.apiKey,
      environment: process.env.NODE_ENV
    });

    // Log available activities and workflows for debugging
    logger.info('Available activities:', { activities: Object.keys(activities) });
    logger.info('Available workflows:', { workflows: Object.keys(workflows) });

    // Connect to Temporal server with optimized settings for persistent workers
    const connectionOptions: any = {
      address: temporalConfig.serverUrl,
      // Optimized timeouts for persistent connections
      connectTimeout: '30s',
      rpcTimeout: '60s',
    };

    // Add TLS and API key for remote connections (Temporal Cloud)
    if (temporalConfig.tls) {
      connectionOptions.tls = {
        // Longer handshake timeout for stable connection
        handshakeTimeout: '30s',
      };
    }

    if (temporalConfig.apiKey) {
      connectionOptions.metadata = {
        'temporal-namespace': temporalConfig.namespace,
      };
      connectionOptions.apiKey = temporalConfig.apiKey;
    }

    logger.info('🔗 Connecting to Temporal server...');
    const connection = await NativeConnection.connect(connectionOptions);
    logger.info('✅ Successfully connected to Temporal server');

    // Create worker with all activities and workflows
    logger.info('🔧 Creating Temporal worker...');
    const worker = await TemporalWorker.create({
      connection,
      namespace: temporalConfig.namespace,
      taskQueue: temporalConfig.taskQueue,
      workflowsPath: require.resolve('../workflows/worker-workflows'),
      activities,
      // Optimize for persistent workers
      maxConcurrentActivityTaskExecutions: 10,
      maxConcurrentWorkflowTaskExecutions: 10,
      // Enable graceful shutdown
      shutdownGraceTime: '30s',
    });

    logger.info('✅ Worker created successfully');

    // Set up graceful shutdown handlers
    const shutdown = async (signal: string) => {
      logger.info(`📝 Received ${signal}, shutting down worker gracefully...`);
      await worker.shutdown();
      await connection.close();
      logger.info('✅ Worker shutdown completed');
      process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

    // Start the worker
    logger.info('🎯 Starting worker execution...');
    logger.info(`📋 Task Queue: ${temporalConfig.taskQueue}`);
    logger.info(`🏢 Namespace: ${temporalConfig.namespace}`);
    
    // In Render, we want the worker to run continuously
    await worker.run();
    
    logger.info('⚠️ Worker execution ended unexpectedly');
    
  } catch (error: any) {
    logger.error('❌ Failed to start worker', { 
      error: error.message,
      stack: error.stack,
      config: {
        serverUrl: temporalConfig.serverUrl,
        namespace: temporalConfig.namespace,
        taskQueue: temporalConfig.taskQueue
      }
    });
    
    // In production, exit with error code
    process.exit(1);
  }
}

// Auto-start when this module is executed directly
if (require.main === module) {
  logger.info('🚀 Starting worker from command line...');
  startWorker().catch((err) => {
    logger.error('💥 Worker startup failed:', err);
    process.exit(1);
  });
}

export { startWorker as default };
module.exports = { startWorker }; 