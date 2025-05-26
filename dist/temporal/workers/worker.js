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
    const startTime = Date.now();
    try {
        console.log('=== Worker.ts: Starting Temporal worker ===');
        logger_1.logger.info('Starting Temporal worker...');
        // Validate required environment variables
        console.log('=== Validating configuration ===');
        if (!config_1.temporalConfig.serverUrl) {
            throw new Error('TEMPORAL_SERVER_URL is required');
        }
        if (!config_1.temporalConfig.namespace) {
            throw new Error('TEMPORAL_NAMESPACE is required');
        }
        // Log configuration for debugging
        console.log('=== Temporal configuration ===');
        logger_1.logger.info('Temporal configuration:', {
            serverUrl: config_1.temporalConfig.serverUrl,
            namespace: config_1.temporalConfig.namespace,
            taskQueue: config_1.temporalConfig.taskQueue,
            tls: config_1.temporalConfig.tls,
            hasApiKey: !!config_1.temporalConfig.apiKey
        });
        // Check activities and workflows
        console.log('=== Checking activities and workflows ===');
        try {
            const activityKeys = Object.keys(activities_1.activities);
            const workflowKeys = Object.keys(workflows);
            logger_1.logger.info('Available activities:', { activities: activityKeys, count: activityKeys.length });
            logger_1.logger.info('Available workflows:', { workflows: workflowKeys, count: workflowKeys.length });
            if (activityKeys.length === 0) {
                logger_1.logger.warn('No activities found - this might cause issues');
            }
            if (workflowKeys.length === 0) {
                logger_1.logger.warn('No workflows found - this might cause issues');
            }
        }
        catch (activityError) {
            logger_1.logger.error('Error checking activities/workflows:', { error: activityError.message });
            throw new Error(`Failed to load activities/workflows: ${activityError.message}`);
        }
        // Connect to Temporal server
        console.log('=== Preparing connection options ===');
        const connectionOptions = {
            address: config_1.temporalConfig.serverUrl,
        };
        // Add TLS and API key for remote connections (Temporal Cloud)
        if (config_1.temporalConfig.tls) {
            connectionOptions.tls = {};
            logger_1.logger.info('TLS enabled for connection');
        }
        if (config_1.temporalConfig.apiKey) {
            connectionOptions.metadata = {
                'temporal-namespace': config_1.temporalConfig.namespace,
            };
            connectionOptions.apiKey = config_1.temporalConfig.apiKey;
            logger_1.logger.info('API key configured for Temporal Cloud');
        }
        logger_1.logger.info('Connection options prepared:', {
            address: connectionOptions.address,
            hasTls: !!connectionOptions.tls,
            hasApiKey: !!connectionOptions.apiKey,
            hasMetadata: !!connectionOptions.metadata
        });
        console.log('=== Attempting to connect to Temporal server ===');
        logger_1.logger.info('Attempting to connect to Temporal server...');
        const connectionStart = Date.now();
        const connection = await worker_1.NativeConnection.connect(connectionOptions);
        const connectionDuration = Date.now() - connectionStart;
        console.log('=== Successfully connected to Temporal server ===');
        logger_1.logger.info('Successfully connected to Temporal server', {
            duration: connectionDuration,
            connectionType: typeof connection
        });
        // Create worker with explicit activities
        console.log('=== Creating Temporal worker ===');
        logger_1.logger.info('Creating Temporal worker...');
        const workerStart = Date.now();
        const worker = await worker_1.Worker.create({
            connection,
            namespace: config_1.temporalConfig.namespace,
            taskQueue: config_1.temporalConfig.taskQueue,
            workflowsPath: require.resolve('../workflows/worker-workflows'),
            activities: {
                fetchDataActivity: activities_1.activities.fetchDataActivity,
                createResourceActivity: activities_1.activities.createResourceActivity,
                updateResourceActivity: activities_1.activities.updateResourceActivity,
                deleteResourceActivity: activities_1.activities.deleteResourceActivity,
                logWorkflowExecutionActivity: activities_1.activities.logWorkflowExecutionActivity,
                storeWorkflowResultActivity: activities_1.activities.storeWorkflowResultActivity,
                fetchConfigurationActivity: activities_1.activities.fetchConfigurationActivity,
                trackApiCallActivity: activities_1.activities.trackApiCallActivity,
            },
        });
        const workerDuration = Date.now() - workerStart;
        console.log('=== Worker created successfully ===');
        logger_1.logger.info('Worker created successfully, starting to run...', {
            duration: workerDuration,
            workerType: typeof worker
        });
        // In serverless environments, we need to handle the worker differently
        if (process.env.VERCEL || process.env.NODE_ENV === 'production') {
            console.log('=== Running in serverless environment ===');
            logger_1.logger.info('Running in serverless environment');
            // Start worker but don't await indefinitely
            console.log('=== Starting worker.run() in background ===');
            const runPromise = worker.run();
            // Set up graceful shutdown
            const shutdown = async () => {
                console.log('=== Shutting down worker ===');
                logger_1.logger.info('Shutting down worker...');
                await worker.shutdown();
            };
            process.on('SIGINT', shutdown);
            process.on('SIGTERM', shutdown);
            const totalDuration = Date.now() - startTime;
            console.log('=== Worker setup completed for serverless ===');
            logger_1.logger.info('Worker setup completed for serverless', {
                totalDuration: totalDuration
            });
            // Return worker instance for management
            return { worker, runPromise, shutdown };
        }
        else {
            // In development, run normally
            console.log('=== Running worker in development mode ===');
            await worker.run();
            logger_1.logger.info('Worker started successfully', { taskQueue: config_1.temporalConfig.taskQueue });
            return worker;
        }
    }
    catch (error) {
        const totalDuration = Date.now() - startTime;
        console.error('=== Worker startup failed ===');
        logger_1.logger.error('Failed to start worker', {
            error: error.message,
            stack: error.stack,
            duration: totalDuration,
            errorName: error.name,
            errorCode: error.code,
            config: {
                serverUrl: config_1.temporalConfig.serverUrl,
                namespace: config_1.temporalConfig.namespace,
                taskQueue: config_1.temporalConfig.taskQueue
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
        }
        else {
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
