// Trigger Workflow Endpoint - Triggered by schedules to execute workflows
require('dotenv').config();

module.exports = async (req, res) => {
  const startTime = Date.now();
  
  try {
    console.log('=== Trigger Workflow Endpoint Called ===');
    console.log('Request details:', {
      method: req.method,
      url: req.url,
      query: req.query,
      headers: {
        'user-agent': req.headers['user-agent'],
        'x-vercel-cron': req.headers['x-vercel-cron']
      },
      timestamp: new Date().toISOString()
    });

    // Environment validation
    if (!process.env.TEMPORAL_SERVER_URL || !process.env.TEMPORAL_NAMESPACE) {
      throw new Error('Missing required Temporal configuration');
    }

    // Return success immediately to prevent timeouts
    res.status(200).json({
      success: true,
      message: 'Workflow trigger initiated',
      timestamp: new Date().toISOString()
    });

    // Execute workflow trigger logic in background
    setTimeout(async () => {
      try {
        console.log('🚀 Starting background workflow trigger...');

        // Import required modules
        const { Client } = require('@temporalio/client');

        // Configure connection with shorter timeouts for quick connection
        const connectionOptions = {
          address: process.env.TEMPORAL_SERVER_URL,
          connectTimeout: '5s',
          rpcTimeout: '10s',
        };

        if (process.env.TEMPORAL_TLS === 'true' || process.env.TEMPORAL_API_KEY) {
          connectionOptions.tls = {
            handshakeTimeout: '5s',
          };
        }

        if (process.env.TEMPORAL_API_KEY) {
          connectionOptions.metadata = {
            'temporal-namespace': process.env.TEMPORAL_NAMESPACE,
          };
          connectionOptions.apiKey = process.env.TEMPORAL_API_KEY;
        }

        console.log('📡 Creating Temporal client connection...');
        const client = new Client({
          connection: connectionOptions,
          namespace: process.env.TEMPORAL_NAMESPACE,
        });

        // Check if there are pending tasks or workflows to execute
        console.log('🔍 Checking for pending workflows...');

        // Execute email sync scheduling workflow
        const workflowId = `sync-emails-schedule-trigger-${Date.now()}`;
        
        console.log('📧 Starting email sync schedule workflow...');
        const handle = await client.workflow.start('syncEmailsScheduleWorkflow', {
          args: [{
            dryRun: false,
            minHoursBetweenSyncs: 1,
            maxSitesToSchedule: 10
          }],
          workflowId,
          taskQueue: process.env.WORKFLOW_TASK_QUEUE || 'default',
          workflowRunTimeout: '5m',
        });

        console.log('✅ Email sync schedule workflow started:', {
          workflowId: handle.workflowId,
          duration: `${Date.now() - startTime}ms`
        });

        // Optional: Start other periodic workflows here
        // You can add more workflow triggers as needed

      } catch (error) {
        console.error('❌ Background workflow trigger failed:', {
          message: error.message,
          stack: error.stack?.split('\n')[0],
          duration: `${Date.now() - startTime}ms`
        });
      }
    }, 100); // Small delay to ensure response is sent first

  } catch (error) {
    const duration = Date.now() - startTime;
    
    console.error('=== Trigger workflow endpoint failed ===');
    console.error('Error details:', {
      message: error.message,
      stack: error.stack,
      name: error.name,
      duration: `${duration}ms`
    });

    if (!res.headersSent) {
      return res.status(500).json({
        success: false,
        error: error.message,
        duration: `${duration}ms`,
        timestamp: new Date().toISOString()
      });
    }
  }
}; 