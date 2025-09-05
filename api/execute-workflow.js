// Execute Workflow Endpoint - Execute specific workflows on-demand
require('dotenv').config();

module.exports = async (req, res) => {
  const startTime = Date.now();
  
  try {
    console.log('=== Execute Workflow Endpoint Called ===');
    console.log('Request details:', {
      method: req.method,
      url: req.url,
      body: req.method === 'POST' ? req.body : undefined,
      timestamp: new Date().toISOString()
    });

    // Only allow POST requests
    if (req.method !== 'POST') {
      return res.status(405).json({
        error: 'Method not allowed',
        allowed: ['POST']
      });
    }

    // Parse request body
    const { workflowType, args = [], options = {} } = req.body || {};

    if (!workflowType) {
      return res.status(400).json({
        error: 'Missing workflowType parameter',
        example: {
          workflowType: 'syncEmailsWorkflow',
          args: [{ userId: '...', siteId: '...' }],
          options: { timeout: '5m' }
        }
      });
    }

    console.log('Workflow execution request:', {
      workflowType,
      argsCount: args.length,
      options
    });

    // Environment validation
    if (!process.env.TEMPORAL_SERVER_URL || !process.env.TEMPORAL_NAMESPACE) {
      throw new Error('Missing required Temporal configuration');
    }

    // Dynamic import to avoid module loading issues
    const { Client } = require('@temporalio/client');

    // Configure connection
    const connectionOptions = {
      address: process.env.TEMPORAL_SERVER_URL,
    };

    if (process.env.TEMPORAL_TLS === 'true' || process.env.TEMPORAL_API_KEY) {
      connectionOptions.tls = {};
    }

    if (process.env.TEMPORAL_API_KEY) {
      connectionOptions.metadata = {
        'temporal-namespace': process.env.TEMPORAL_NAMESPACE,
      };
      connectionOptions.apiKey = process.env.TEMPORAL_API_KEY;
    }

    console.log('Creating Temporal client...');
    const client = new Client({
      connection: connectionOptions,
      namespace: process.env.TEMPORAL_NAMESPACE,
    });

    // Generate unique workflow ID
    const workflowId = `${workflowType}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Compute task queue using shared mapper
    const { getTaskQueueForWorkflow } = require('../dist/temporal/config/taskQueues');
    const selectedTaskQueue = getTaskQueueForWorkflow(workflowType);

    console.log('Starting workflow:', {
      workflowId,
      workflowType,
      taskQueue: selectedTaskQueue
    });

    // Start workflow execution
    const handle = await client.workflow.start(workflowType, {
      args,
      workflowId,
      taskQueue: selectedTaskQueue,
      workflowRunTimeout: options.timeout || '10m',
    });

    const duration = Date.now() - startTime;

    console.log('Workflow started successfully:', {
      workflowId: handle.workflowId,
      duration: `${duration}ms`
    });

    // Return success response immediately (don't wait for workflow completion)
    return res.status(200).json({
      success: true,
      workflowId: handle.workflowId,
      workflowType,
      status: 'started',
      message: 'Workflow started successfully',
      duration: `${duration}ms`,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    const duration = Date.now() - startTime;
    
    console.error('=== Workflow execution failed ===');
    console.error('Error details:', {
      message: error.message,
      stack: error.stack,
      name: error.name,
      duration: `${duration}ms`
    });

    return res.status(500).json({
      success: false,
      error: error.message,
      workflowType: req.body?.workflowType || 'unknown',
      duration: `${duration}ms`,
      timestamp: new Date().toISOString()
    });
  }
}; 