/**
 * Enhanced Execute Workflow API with Priority Support
 * 
 * Extends the basic execute-workflow.js with priority-based execution.
 * Automatically assigns task queues based on workflow type and priority.
 */

module.exports = async (req, res) => {
  const startTime = Date.now();
  
  try {
    console.log('=== Priority Execute Workflow Endpoint Called ===');
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

    // Parse request body with priority support
    const { 
      workflowType, 
      args = [], 
      options = {},
      priority,        // NEW: 'critical' | 'high' | 'normal' | 'low' | 'background'
      taskQueue,       // NEW: Custom task queue override
      expedite = false // NEW: Force high priority for urgent situations
    } = req.body || {};

    if (!workflowType) {
      return res.status(400).json({
        error: 'Missing workflowType parameter',
        example: {
          workflowType: 'customerSupportMessageWorkflow',
          args: [{ emailData: '...', baseParams: '...' }],
          priority: 'critical',  // NEW: Optional priority
          expedite: true,        // NEW: Force urgent execution
          options: { timeout: '2m' }
        }
      });
    }

    console.log('Priority workflow execution request:', {
      workflowType,
      argsCount: args.length,
      priority: priority || 'auto',
      expedite,
      customTaskQueue: taskQueue,
      options
    });

    // Environment validation
    if (!process.env.TEMPORAL_SERVER_URL || !process.env.TEMPORAL_NAMESPACE) {
      throw new Error('Missing required Temporal configuration');
    }

    // Dynamic import to avoid module loading issues
    const { Client } = require('@temporalio/client');

    // Task Queue Priority Mapping (replicate from taskQueues.ts)
    const TASK_QUEUES = {
      CRITICAL: 'critical-priority',
      HIGH: 'high-priority',
      NORMAL: 'default',
      LOW: 'low-priority',
      BACKGROUND: 'background-priority'
    };

    /**
     * Get task queue based on workflow type and priority
     */
    function getTaskQueueForWorkflow(workflowType, priority, expedite) {
      // Global override via environment variable (e.g., FORCE_TASK_QUEUE=default)
      if (process.env.FORCE_TASK_QUEUE) {
        return process.env.FORCE_TASK_QUEUE;
      }

      // Override with custom task queue if provided
      if (taskQueue) {
        return taskQueue;
      }

      // Force critical if expedited
      if (expedite) {
        return TASK_QUEUES.CRITICAL;
      }

      // Explicit priority override
      if (priority) {
        switch (priority) {
          case 'critical': return TASK_QUEUES.CRITICAL;
          case 'high': return TASK_QUEUES.HIGH;
          case 'normal': return TASK_QUEUES.NORMAL;
          case 'low': return TASK_QUEUES.LOW;
          case 'background': return TASK_QUEUES.BACKGROUND;
        }
      }

      // Auto-assign based on workflow type
      switch (workflowType) {
        // High priority workflows (moved from critical)
        case 'customerSupportMessageWorkflow':
        case 'emailCustomerSupportMessageWorkflow':
          return TASK_QUEUES.HIGH;
        
        // High priority workflows
        case 'leadAttentionWorkflow':
        case 'sendEmailFromAgentWorkflow':
        case 'sendWhatsappFromAgentWorkflow':
          return TASK_QUEUES.HIGH;
        
        // Normal priority workflows
        case 'dailyStandUpWorkflow':
        case 'leadGenerationWorkflow':
        case 'dailyProspectionWorkflow':
          return TASK_QUEUES.NORMAL;
        
        // Low priority workflows
        case 'buildCampaignsWorkflow':
        case 'buildContentWorkflow':
        case 'analyzeSiteWorkflow':
          return TASK_QUEUES.LOW;
        
        // Background workflows
        case 'dailyOperationsWorkflow':
        case 'scheduleActivitiesWorkflow':
        case 'syncEmailsScheduleWorkflow':
          return TASK_QUEUES.BACKGROUND;
        
        default:
          return TASK_QUEUES.NORMAL;
      }
    }

    /**
     * Get timeout based on priority
     */
    function getTimeoutForPriority(selectedTaskQueue, customTimeout) {
      if (customTimeout) return customTimeout;
      
      switch (selectedTaskQueue) {
        case TASK_QUEUES.CRITICAL: return '2m';
        case TASK_QUEUES.HIGH: return '5m';
        case TASK_QUEUES.NORMAL: return '15m';
        case TASK_QUEUES.LOW: return '30m';
        case TASK_QUEUES.BACKGROUND: return '60m';
        default: return '15m';
      }
    }

    // Determine execution configuration
    const selectedTaskQueue = getTaskQueueForWorkflow(workflowType, priority, expedite);
    const workflowTimeout = getTimeoutForPriority(selectedTaskQueue, options.timeout);

    // Configure connection
    const connectionOptions = {
      address: process.env.TEMPORAL_SERVER_URL,
    };

    // Add TLS and API key for remote connections (Temporal Cloud)
    if (process.env.TEMPORAL_TLS === 'true' || process.env.TEMPORAL_API_KEY) {
      connectionOptions.tls = true;
    }

    if (process.env.TEMPORAL_API_KEY) {
      connectionOptions.metadata = {
        'temporal-namespace': process.env.TEMPORAL_NAMESPACE,
      };
      connectionOptions.apiKey = process.env.TEMPORAL_API_KEY;
    }

    console.log('Connecting to Temporal with priority configuration:', {
      serverUrl: process.env.TEMPORAL_SERVER_URL,
      namespace: process.env.TEMPORAL_NAMESPACE,
      taskQueue: selectedTaskQueue,
      timeout: workflowTimeout,
      tls: !!connectionOptions.tls
    });

    const client = new Client({
      connection: connectionOptions,
      namespace: process.env.TEMPORAL_NAMESPACE,
    });

    // Generate unique workflow ID with priority indicator
    const priorityPrefix = expedite ? 'URGENT' : 
                          priority ? priority.toUpperCase() : 
                          'AUTO';
    const workflowId = `${priorityPrefix}-${workflowType}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    console.log('Starting priority workflow:', {
      workflowId,
      workflowType,
      taskQueue: selectedTaskQueue,
      timeout: workflowTimeout,
      priority: priority || 'auto-assigned',
      expedited: expedite
    });

    // Start workflow execution with priority configuration
    const handle = await client.workflow.start(workflowType, {
      args,
      workflowId,
      taskQueue: selectedTaskQueue,
      workflowRunTimeout: workflowTimeout,
    });

    const duration = Date.now() - startTime;

    console.log('Priority workflow started successfully:', {
      workflowId: handle.workflowId,
      taskQueue: selectedTaskQueue,
      priority: priority || 'auto-assigned',
      expedited: expedite,
      duration: `${duration}ms`
    });

    // Return success response with priority information
    return res.status(200).json({
      success: true,
      workflowId: handle.workflowId,
      workflowType,
      priority: {
        requested: priority || 'auto',
        assigned: selectedTaskQueue,
        expedited: expedite
      },
      configuration: {
        taskQueue: selectedTaskQueue,
        timeout: workflowTimeout
      },
      status: 'started',
      message: `Priority workflow started successfully on ${selectedTaskQueue} queue`,
      duration: `${duration}ms`,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    const duration = Date.now() - startTime;
    
    console.error('=== Priority workflow execution failed ===');
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
      priority: req.body?.priority || 'unknown',
      expedited: req.body?.expedite || false,
      duration: `${duration}ms`,
      timestamp: new Date().toISOString()
    });
  }
};
