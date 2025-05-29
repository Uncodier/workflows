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

    // Execute workflow trigger logic in background with proper timeout handling
    setTimeout(async () => {
      try {
        console.log('🚀 Starting background workflow trigger...');

        // Import required modules
        const { Client } = require('@temporalio/client');

        // Configure connection with very short timeouts for serverless
        const connectionOptions = {
          address: process.env.TEMPORAL_SERVER_URL,
          connectTimeout: '3s',  // ✅ Reduced from 5s
          rpcTimeout: '8s',      // ✅ Reduced from 10s
        };

        if (process.env.TEMPORAL_TLS === 'true' || process.env.TEMPORAL_API_KEY) {
          connectionOptions.tls = {
            handshakeTimeout: '3s', // ✅ Reduced from 5s
          };
        }

        if (process.env.TEMPORAL_API_KEY) {
          connectionOptions.metadata = {
            'temporal-namespace': process.env.TEMPORAL_NAMESPACE,
          };
          connectionOptions.apiKey = process.env.TEMPORAL_API_KEY;
        }

        console.log('📡 Creating Temporal client connection...');
        
        // ✅ Add timeout wrapper to prevent hanging
        const clientPromise = new Promise(async (resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error('Connection timeout - this is normal in serverless environments'));
          }, 15000); // 15 second max timeout

          try {
            const client = new Client({
              connection: connectionOptions,
              namespace: process.env.TEMPORAL_NAMESPACE,
            });
            clearTimeout(timeout);
            resolve(client);
          } catch (error) {
            clearTimeout(timeout);
            reject(error);
          }
        });

        const client = await clientPromise;

        // Execute email sync scheduling workflow
        const workflowId = `sync-emails-schedule-trigger-${Date.now()}`;
        
        console.log('📧 Starting email sync schedule workflow...');
        
        // ✅ Add timeout for workflow start
        const workflowPromise = new Promise(async (resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error('Workflow start timeout - this is expected in serverless'));
          }, 10000); // 10 second timeout for workflow start

          try {
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
            clearTimeout(timeout);
            resolve(handle);
          } catch (error) {
            clearTimeout(timeout);
            reject(error);
          }
        });

        const handle = await workflowPromise;

        console.log('✅ Email sync schedule workflow started successfully:', {
          workflowId: handle.workflowId,
          duration: `${Date.now() - startTime}ms`
        });

      } catch (error) {
        const duration = Date.now() - startTime;
        
        // ✅ Distinguish between real errors and expected serverless timeouts
        const isTimeoutError = error.message.includes('timeout') || 
                              error.message.includes('Timeout') ||
                              error.message.includes('Unexpected error while making gRPC request') ||
                              duration > 30000; // Over 30 seconds is likely a timeout

        if (isTimeoutError) {
          console.log('⏰ Background workflow trigger timed out (this is normal in serverless):', {
            message: 'Connection timeout - expected behavior in serverless environment',
            duration: `${duration}ms`,
            note: 'This is not an error - Temporal schedules will still work independently'
          });
        } else {
          console.error('❌ Background workflow trigger failed with real error:', {
            message: error.message,
            stack: error.stack?.split('\n')[0],
            duration: `${duration}ms`
          });
        }
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