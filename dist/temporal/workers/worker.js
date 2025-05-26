"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startWorker = startWorker;
const worker_1 = require("@temporalio/worker");
const activities_1 = require("../activities");
const logger_1 = require("../../lib/logger");
const config_1 = require("../../config/config");
/**
 * Start a Temporal worker
 */
async function startWorker() {
    try {
        logger_1.logger.info('Starting Temporal worker...');
        // Connect to Temporal server
        const connection = await worker_1.NativeConnection.connect({
            address: config_1.temporalConfig.serverUrl,
        });
        logger_1.logger.info('Connecting to Temporal server', { url: config_1.temporalConfig.serverUrl });
        // Create worker
        const worker = await worker_1.Worker.create({
            connection,
            namespace: config_1.temporalConfig.namespace,
            taskQueue: config_1.temporalConfig.taskQueue,
            workflowsPath: require.resolve('../workflows'),
            activities: activities_1.activities,
        });
        logger_1.logger.info('Creating Temporal worker', {
            namespace: config_1.temporalConfig.namespace,
            taskQueue: config_1.temporalConfig.taskQueue,
        });
        // Start worker
        await worker.run();
        logger_1.logger.info('Worker started successfully', { taskQueue: config_1.temporalConfig.taskQueue });
        return worker;
    }
    catch (error) {
        logger_1.logger.error('Failed to start worker', { error });
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
