import { NativeConnection, Worker as TemporalWorker } from '@temporalio/worker';
import { activities } from '../activities';
import { logger } from '../../lib/logger';
import { temporalConfig, workerVersioningConfig } from '../../config/config';
import * as workflows from '../workflows/worker-workflows';

/**
 * Start a Temporal worker for Render deployment
 */
export async function startWorker() {
  try {
    console.log('🚀 Starting Temporal worker...');
    logger.info('🚀 Starting Temporal worker on Render...');

    // Validate required environment variables
    console.log('📋 Checking environment variables...');
    if (!temporalConfig.serverUrl) {
      throw new Error('TEMPORAL_SERVER_URL is required');
    }

    if (!temporalConfig.namespace) {
      throw new Error('TEMPORAL_NAMESPACE is required');
    }
    console.log('✅ Environment variables validated');

    // Log configuration for debugging
    logger.info('Temporal configuration:', {
      serverUrl: temporalConfig.serverUrl,
      namespace: temporalConfig.namespace,
      taskQueue: temporalConfig.taskQueue,
      tls: temporalConfig.tls,
      hasApiKey: !!temporalConfig.apiKey,
      environment: process.env.NODE_ENV,
      workerVersioning: workerVersioningConfig.useWorkerVersioning ? {
        buildId: workerVersioningConfig.buildId,
        deploymentName: workerVersioningConfig.deploymentName,
        defaultVersioningBehavior: workerVersioningConfig.defaultVersioningBehavior
      } : 'disabled'
    });

    // Log available activities and workflows for debugging
    console.log('📦 Loading activities and workflows...');
    logger.info('Available activities:', { activities: Object.keys(activities) });
    logger.info('Available workflows:', { workflows: Object.keys(workflows) });
    console.log(`✅ Loaded ${Object.keys(activities).length} activities and ${Object.keys(workflows).length} workflows`);

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

    // SAFEGUARD RE-APPLIED HERE TO ENSURE IT ALWAYS CATCHES RENDER'S CACHE ISSUE
    let finalApiKey = temporalConfig.apiKey;
    if (finalApiKey && finalApiKey.endsWith('cVD1LO_8QFj3RW8aVe6p7lg')) {
      console.warn('⚠️ WARNING (Worker): Detected stale/expired API Key injected by Render cache.');
      finalApiKey = process.env.TEMPORAL_API_KEY_NEW || finalApiKey;
    }

    if (finalApiKey) {
      connectionOptions.metadata = {
        'temporal-namespace': temporalConfig.namespace,
      };
      connectionOptions.apiKey = finalApiKey;
    }

    console.log('🔗 Connecting to Temporal server...');
    console.log('Connection options:', JSON.stringify(connectionOptions, null, 2));
    logger.info('🔗 Connecting to Temporal server...');
    const connection = await NativeConnection.connect(connectionOptions);
    console.log('✅ Successfully connected to Temporal server');
    logger.info('✅ Successfully connected to Temporal server');

    // Create worker with all activities and workflows
    console.log('🔧 Creating Temporal worker...');
    logger.info('🔧 Creating Temporal worker...');
    
    const workerOptions: any = {
      connection,
      namespace: temporalConfig.namespace,
      taskQueue: temporalConfig.taskQueue,
      workflowsPath: require.resolve('../workflows/worker-workflows'),
      activities,
      // Optimize for persistent workers
      maxConcurrentActivityTaskExecutions: 10,
      maxConcurrentWorkflowTaskExecutions: 10,
    };

    // Add worker versioning configuration if enabled
    if (workerVersioningConfig.useWorkerVersioning) {
      // Only include defaultVersioningBehavior if it's explicitly set to PINNED or AUTO_UPGRADE
      // UNSPECIFIED, undefined, or empty means "don't set a default", so we omit the field completely
      const behavior = workerVersioningConfig.defaultVersioningBehavior;
      const validBehaviors = ['PINNED', 'AUTO_UPGRADE'];
      
      // Build deployment options object conditionally
      const deploymentOptions: any = {
        useWorkerVersioning: true,
        version: {
          buildId: workerVersioningConfig.buildId,
          deploymentName: workerVersioningConfig.deploymentName,
        },
      };

      // Only add defaultVersioningBehavior if it's a valid value
      // This ensures the field is completely omitted if behavior is UNSPECIFIED, undefined, or invalid
      if (behavior && typeof behavior === 'string' && validBehaviors.includes(behavior)) {
        deploymentOptions.defaultVersioningBehavior = behavior;
      }

      // Log the final object structure for debugging
      console.log('📦 Worker deployment options structure:', JSON.stringify({
        useWorkerVersioning: deploymentOptions.useWorkerVersioning,
        version: deploymentOptions.version,
        hasDefaultVersioningBehavior: 'defaultVersioningBehavior' in deploymentOptions,
        defaultVersioningBehavior: deploymentOptions.defaultVersioningBehavior || 'NOT SET'
      }, null, 2));

      // Final verification: ensure defaultVersioningBehavior is not undefined
      // Remove it completely if it's not a valid value
      if ('defaultVersioningBehavior' in deploymentOptions && 
          (!deploymentOptions.defaultVersioningBehavior || 
           !validBehaviors.includes(deploymentOptions.defaultVersioningBehavior))) {
        delete deploymentOptions.defaultVersioningBehavior;
      }

      workerOptions.workerDeploymentOptions = deploymentOptions;

      console.log('📦 Worker versioning enabled:', {
        buildId: workerVersioningConfig.buildId,
        deploymentName: workerVersioningConfig.deploymentName,
        defaultVersioningBehavior: validBehaviors.includes(behavior || '') 
          ? behavior 
          : 'not set (UNSPECIFIED or invalid)',
        rawBehavior: behavior
      });
      logger.info('📦 Worker versioning enabled', {
        buildId: workerVersioningConfig.buildId,
        deploymentName: workerVersioningConfig.deploymentName,
        defaultVersioningBehavior: validBehaviors.includes(behavior || '') 
          ? behavior 
          : 'not set (UNSPECIFIED or invalid)',
        rawBehavior: behavior
      });
    }
    
    // Final safety check: ensure workerDeploymentOptions doesn't have undefined defaultVersioningBehavior
    // This is critical because the SDK throws an error if the field exists with undefined value
    if (workerOptions.workerDeploymentOptions) {
      const depOpts = workerOptions.workerDeploymentOptions as any;
      const validBehaviors = ['PINNED', 'AUTO_UPGRADE'];
      
      // Remove the field if it's not a valid value
      if (!depOpts.defaultVersioningBehavior || 
          !validBehaviors.includes(depOpts.defaultVersioningBehavior) ||
          depOpts.defaultVersioningBehavior === 'UNSPECIFIED' ||
          depOpts.defaultVersioningBehavior === undefined ||
          depOpts.defaultVersioningBehavior === null) {
        // Use Reflect.deleteProperty to ensure complete removal
        Reflect.deleteProperty(depOpts, 'defaultVersioningBehavior');
        // Also try delete as fallback
        delete depOpts.defaultVersioningBehavior;
      }
      
      // Final verification: ensure the field is completely gone
      if ('defaultVersioningBehavior' in depOpts) {
        console.warn('⚠️ WARNING: defaultVersioningBehavior still present after cleanup, forcing removal');
        Reflect.deleteProperty(depOpts, 'defaultVersioningBehavior');
        delete depOpts.defaultVersioningBehavior;
      }
    }

    // Log final structure before creating worker
    if (workerOptions.workerDeploymentOptions) {
      const depOpts = workerOptions.workerDeploymentOptions as any;
      console.log('📦 Final workerDeploymentOptions structure:', JSON.stringify({
        useWorkerVersioning: depOpts.useWorkerVersioning,
        version: depOpts.version,
        hasDefaultVersioningBehavior: 'defaultVersioningBehavior' in depOpts,
        defaultVersioningBehavior: depOpts.defaultVersioningBehavior || 'FIELD NOT PRESENT'
      }, null, 2));
    }

    console.log('Worker options:', JSON.stringify({
      ...workerOptions,
      connection: '[CONNECTION_OBJECT]',
      activities: `[${Object.keys(activities).length} activities]`
    }, null, 2));
    
    const worker = await TemporalWorker.create(workerOptions);

    console.log('✅ Worker created successfully');
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
    console.log('🎯 Starting worker execution...');
    console.log(`📋 Task Queue: ${temporalConfig.taskQueue}`);
    console.log(`🏢 Namespace: ${temporalConfig.namespace}`);
    logger.info('🎯 Starting worker execution...');
    logger.info(`📋 Task Queue: ${temporalConfig.taskQueue}`);
    logger.info(`🏢 Namespace: ${temporalConfig.namespace}`);
    
    // In Render, we want the worker to run continuously
    console.log('🔄 Calling worker.run()...');
    
    // Return worker instance instead of blocking on run
    return {
      worker,
      runPromise: worker.run(),
      shutdown: async () => {
        await worker.shutdown();
        await connection.close();
      }
    };
    
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

// Export for CommonJS and ES modules compatibility
module.exports = { startWorker };
module.exports.startWorker = startWorker;
module.exports.default = startWorker; 