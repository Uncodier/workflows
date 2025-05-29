"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.startWorker = startWorker;
const worker_1 = require("@temporalio/worker");
const activities_1 = require("../activities");
const logger_1 = require("../../lib/logger");
const config_1 = require("../../config/config");
const workflows = __importStar(require("../workflows/worker-workflows"));
/**
 * Start a Temporal worker
 */
async function startWorker() {
    try {
        logger_1.logger.info('Starting Temporal worker...');
        // Validate required environment variables
        if (!config_1.temporalConfig.serverUrl) {
            throw new Error('TEMPORAL_SERVER_URL is required');
        }
        if (!config_1.temporalConfig.namespace) {
            throw new Error('TEMPORAL_NAMESPACE is required');
        }
        // Log configuration for debugging
        logger_1.logger.info('Temporal configuration:', {
            serverUrl: config_1.temporalConfig.serverUrl,
            namespace: config_1.temporalConfig.namespace,
            taskQueue: config_1.temporalConfig.taskQueue,
            tls: config_1.temporalConfig.tls,
            hasApiKey: !!config_1.temporalConfig.apiKey
        });
        // Log available activities and workflows for debugging
        logger_1.logger.info('Available activities:', { activities: Object.keys(activities_1.activities) });
        logger_1.logger.info('Available workflows:', { workflows: Object.keys(workflows) });
        // Connect to Temporal server
        const connectionOptions = {
            address: config_1.temporalConfig.serverUrl,
        };
        // Add TLS and API key for remote connections (Temporal Cloud)
        if (config_1.temporalConfig.tls) {
            connectionOptions.tls = {};
        }
        if (config_1.temporalConfig.apiKey) {
            connectionOptions.metadata = {
                'temporal-namespace': config_1.temporalConfig.namespace,
            };
            connectionOptions.apiKey = config_1.temporalConfig.apiKey;
        }
        logger_1.logger.info('Attempting to connect to Temporal server...');
        const connection = await worker_1.NativeConnection.connect(connectionOptions);
        logger_1.logger.info('Successfully connected to Temporal server');
        // Create worker with all activities
        logger_1.logger.info('Creating Temporal worker...');
        const worker = await worker_1.Worker.create({
            connection,
            namespace: config_1.temporalConfig.namespace,
            taskQueue: config_1.temporalConfig.taskQueue,
            workflowsPath: require.resolve('../workflows/worker-workflows'),
            activities: activities_1.activities,
        });
        logger_1.logger.info('Worker created successfully, starting to run...');
        // In serverless environments, we need to handle the worker differently
        if (process.env.VERCEL || process.env.NODE_ENV === 'production') {
            logger_1.logger.info('Running in serverless environment');
            // Start worker but don't await indefinitely
            const runPromise = worker.run();
            // Set up graceful shutdown
            const shutdown = async () => {
                logger_1.logger.info('Shutting down worker...');
                await worker.shutdown();
            };
            process.on('SIGINT', shutdown);
            process.on('SIGTERM', shutdown);
            // Return worker instance for management
            return { worker, runPromise, shutdown };
        }
        else {
            // In development, run normally
            await worker.run();
            logger_1.logger.info('Worker started successfully', { taskQueue: config_1.temporalConfig.taskQueue });
            return worker;
        }
    }
    catch (error) {
        logger_1.logger.error('Failed to start worker', {
            error: error.message,
            stack: error.stack,
            config: {
                serverUrl: config_1.temporalConfig.serverUrl,
                namespace: config_1.temporalConfig.namespace,
                taskQueue: config_1.temporalConfig.taskQueue
            }
        });
        // In serverless environments, don't exit the process
        if (process.env.VERCEL || process.env.NODE_ENV === 'production') {
            throw error;
        }
        else {
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
