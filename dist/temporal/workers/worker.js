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
 * Start a Temporal worker for Render deployment
 */
async function startWorker() {
    try {
        console.log('🚀 Starting Temporal worker...');
        logger_1.logger.info('🚀 Starting Temporal worker on Render...');
        // Validate required environment variables
        console.log('📋 Checking environment variables...');
        if (!config_1.temporalConfig.serverUrl) {
            throw new Error('TEMPORAL_SERVER_URL is required');
        }
        if (!config_1.temporalConfig.namespace) {
            throw new Error('TEMPORAL_NAMESPACE is required');
        }
        console.log('✅ Environment variables validated');
        // Log configuration for debugging
        logger_1.logger.info('Temporal configuration:', {
            serverUrl: config_1.temporalConfig.serverUrl,
            namespace: config_1.temporalConfig.namespace,
            taskQueue: config_1.temporalConfig.taskQueue,
            tls: config_1.temporalConfig.tls,
            hasApiKey: !!config_1.temporalConfig.apiKey,
            environment: process.env.NODE_ENV,
            workerVersioning: config_1.workerVersioningConfig.useWorkerVersioning ? {
                buildId: config_1.workerVersioningConfig.buildId,
                deploymentName: config_1.workerVersioningConfig.deploymentName,
                defaultVersioningBehavior: config_1.workerVersioningConfig.defaultVersioningBehavior
            } : 'disabled'
        });
        // Log available activities and workflows for debugging
        console.log('📦 Loading activities and workflows...');
        logger_1.logger.info('Available activities:', { activities: Object.keys(activities_1.activities) });
        logger_1.logger.info('Available workflows:', { workflows: Object.keys(workflows) });
        console.log(`✅ Loaded ${Object.keys(activities_1.activities).length} activities and ${Object.keys(workflows).length} workflows`);
        // Connect to Temporal server with optimized settings for persistent workers
        const connectionOptions = {
            address: config_1.temporalConfig.serverUrl,
            // Optimized timeouts for persistent connections
            connectTimeout: '30s',
            rpcTimeout: '60s',
        };
        // Add TLS and API key for remote connections (Temporal Cloud)
        if (config_1.temporalConfig.tls) {
            connectionOptions.tls = {
                // Longer handshake timeout for stable connection
                handshakeTimeout: '30s',
            };
        }
        // SAFEGUARD RE-APPLIED HERE TO ENSURE IT ALWAYS CATCHES RENDER'S CACHE ISSUE
        let finalApiKey = config_1.temporalConfig.apiKey;
        if (finalApiKey && finalApiKey.endsWith('cVD1LO_8QFj3RW8aVe6p7lg')) {
            console.warn('⚠️ WARNING (Worker): Detected stale/expired API Key injected by Render cache.');
            finalApiKey = process.env.TEMPORAL_API_KEY_NEW || finalApiKey;
        }
        if (finalApiKey) {
            connectionOptions.metadata = {
                'temporal-namespace': config_1.temporalConfig.namespace,
            };
            connectionOptions.apiKey = finalApiKey;
        }
        console.log('🔗 Connecting to Temporal server...');
        console.log('Connection options:', JSON.stringify(connectionOptions, null, 2));
        logger_1.logger.info('🔗 Connecting to Temporal server...');
        const connection = await worker_1.NativeConnection.connect(connectionOptions);
        console.log('✅ Successfully connected to Temporal server');
        logger_1.logger.info('✅ Successfully connected to Temporal server');
        // Create worker with all activities and workflows
        console.log('🔧 Creating Temporal worker...');
        logger_1.logger.info('🔧 Creating Temporal worker...');
        const workerOptions = {
            connection,
            namespace: config_1.temporalConfig.namespace,
            taskQueue: config_1.temporalConfig.taskQueue,
            workflowsPath: require.resolve('../workflows/worker-workflows'),
            activities: activities_1.activities,
            // Optimize for persistent workers
            maxConcurrentActivityTaskExecutions: 10,
            maxConcurrentWorkflowTaskExecutions: 10,
        };
        // Add worker versioning configuration if enabled
        if (config_1.workerVersioningConfig.useWorkerVersioning) {
            // Only include defaultVersioningBehavior if it's explicitly set to PINNED or AUTO_UPGRADE
            // UNSPECIFIED, undefined, or empty means "don't set a default", so we omit the field completely
            const behavior = config_1.workerVersioningConfig.defaultVersioningBehavior;
            const validBehaviors = ['PINNED', 'AUTO_UPGRADE'];
            // Build deployment options object conditionally
            const deploymentOptions = {
                useWorkerVersioning: true,
                version: {
                    buildId: config_1.workerVersioningConfig.buildId,
                    deploymentName: config_1.workerVersioningConfig.deploymentName,
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
                buildId: config_1.workerVersioningConfig.buildId,
                deploymentName: config_1.workerVersioningConfig.deploymentName,
                defaultVersioningBehavior: validBehaviors.includes(behavior || '')
                    ? behavior
                    : 'not set (UNSPECIFIED or invalid)',
                rawBehavior: behavior
            });
            logger_1.logger.info('📦 Worker versioning enabled', {
                buildId: config_1.workerVersioningConfig.buildId,
                deploymentName: config_1.workerVersioningConfig.deploymentName,
                defaultVersioningBehavior: validBehaviors.includes(behavior || '')
                    ? behavior
                    : 'not set (UNSPECIFIED or invalid)',
                rawBehavior: behavior
            });
        }
        // Final safety check: ensure workerDeploymentOptions doesn't have undefined defaultVersioningBehavior
        // This is critical because the SDK throws an error if the field exists with undefined value
        if (workerOptions.workerDeploymentOptions) {
            const depOpts = workerOptions.workerDeploymentOptions;
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
            const depOpts = workerOptions.workerDeploymentOptions;
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
            activities: `[${Object.keys(activities_1.activities).length} activities]`
        }, null, 2));
        const worker = await worker_1.Worker.create(workerOptions);
        console.log('✅ Worker created successfully');
        logger_1.logger.info('✅ Worker created successfully');
        // Set up graceful shutdown handlers
        const shutdown = async (signal) => {
            logger_1.logger.info(`📝 Received ${signal}, shutting down worker gracefully...`);
            await worker.shutdown();
            await connection.close();
            logger_1.logger.info('✅ Worker shutdown completed');
            process.exit(0);
        };
        process.on('SIGINT', () => shutdown('SIGINT'));
        process.on('SIGTERM', () => shutdown('SIGTERM'));
        // Start the worker
        console.log('🎯 Starting worker execution...');
        console.log(`📋 Task Queue: ${config_1.temporalConfig.taskQueue}`);
        console.log(`🏢 Namespace: ${config_1.temporalConfig.namespace}`);
        logger_1.logger.info('🎯 Starting worker execution...');
        logger_1.logger.info(`📋 Task Queue: ${config_1.temporalConfig.taskQueue}`);
        logger_1.logger.info(`🏢 Namespace: ${config_1.temporalConfig.namespace}`);
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
    }
    catch (error) {
        logger_1.logger.error('❌ Failed to start worker', {
            error: error.message,
            stack: error.stack,
            config: {
                serverUrl: config_1.temporalConfig.serverUrl,
                namespace: config_1.temporalConfig.namespace,
                taskQueue: config_1.temporalConfig.taskQueue
            }
        });
        // In production, exit with error code
        process.exit(1);
    }
}
// Auto-start when this module is executed directly
if (require.main === module) {
    logger_1.logger.info('🚀 Starting worker from command line...');
    startWorker().catch((err) => {
        logger_1.logger.error('💥 Worker startup failed:', err);
        process.exit(1);
    });
}
// Export for CommonJS and ES modules compatibility
module.exports = { startWorker };
module.exports.startWorker = startWorker;
module.exports.default = startWorker;
