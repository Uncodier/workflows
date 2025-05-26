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

    // Log available activities and workflows for debugging
    logger.info('Available activities:', { activities: Object.keys(activities) });
    logger.info('Available workflows:', { workflows: Object.keys(workflows) });

    // Connect to Temporal server
    const connection = await NativeConnection.connect({
      address: temporalConfig.serverUrl,
    });

    logger.info('Connecting to Temporal server', { url: temporalConfig.serverUrl });

    // Create worker with explicit activities
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

    logger.info('Creating Temporal worker', {
      namespace: temporalConfig.namespace,
      taskQueue: temporalConfig.taskQueue,
    });

    // Start worker
    await worker.run();
    
    logger.info('Worker started successfully', { taskQueue: temporalConfig.taskQueue });
    
    return worker;
  } catch (error) {
    logger.error('Failed to start worker', { error });
    process.exit(1);
  }
}

if (require.main === module) {
  startWorker().catch((err) => {
    console.error('Worker startup failed:', err);
    process.exit(1);
  });
}

module.exports = { startWorker }; 