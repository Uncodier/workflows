require('dotenv').config();
const { Client } = require('@temporalio/client');

// Status endpoint to check if the service is running
module.exports = async (req, res) => {
  const startTime = Date.now();
  
  try {
    console.log('=== Status endpoint called ===');
    
    // Basic environment check
    const envStatus = {
      NODE_ENV: process.env.NODE_ENV,
      TEMPORAL_SERVER_URL: process.env.TEMPORAL_SERVER_URL ? 'SET' : 'NOT_SET',
      TEMPORAL_NAMESPACE: process.env.TEMPORAL_NAMESPACE || 'default',
      TEMPORAL_API_KEY: process.env.TEMPORAL_API_KEY ? 'SET' : 'NOT_SET',
      TEMPORAL_TLS: process.env.TEMPORAL_TLS,
      WORKFLOW_TASK_QUEUE: process.env.WORKFLOW_TASK_QUEUE || 'default',
      VERCEL: process.env.VERCEL ? 'SET' : 'NOT_SET'
    };

    console.log('Environment status:', envStatus);

    let temporalStatus = {
      connected: false,
      error: null,
      schedules: [],
      connection_duration: null
    };

    // Try to connect to Temporal and check schedules
    if (process.env.TEMPORAL_SERVER_URL && process.env.TEMPORAL_NAMESPACE) {
      try {
        console.log('=== Attempting to connect to Temporal ===');
        
        const connectionStart = Date.now();
        
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

        const client = new Client({
          connection: connectionOptions,
          namespace: process.env.TEMPORAL_NAMESPACE,
        });

        temporalStatus.connection_duration = Date.now() - connectionStart;
        temporalStatus.connected = true;
        
        console.log('=== Connected to Temporal, checking schedules ===');
        
        // Try to list schedules
        try {
          const scheduleHandle = client.schedule;
          const schedules = await scheduleHandle.list();
          
          temporalStatus.schedules = [];
          for await (const schedule of schedules) {
            temporalStatus.schedules.push({
              id: schedule.scheduleId,
              // Add more schedule details if available
            });
          }
          
          console.log(`Found ${temporalStatus.schedules.length} schedules`);
        } catch (scheduleError) {
          console.error('Error listing schedules:', scheduleError);
          temporalStatus.schedule_error = scheduleError.message;
        }

      } catch (connectionError) {
        console.error('=== Failed to connect to Temporal ===');
        console.error('Connection error:', {
          message: connectionError.message,
          stack: connectionError.stack,
          name: connectionError.name,
          code: connectionError.code
        });
        
        temporalStatus.error = {
          message: connectionError.message,
          name: connectionError.name,
          code: connectionError.code
        };
      }
    } else {
      temporalStatus.error = 'Missing required Temporal configuration';
    }

    // File system check
    const fs = require('fs');
    const path = require('path');
    
    const fileSystemStatus = {
      dist_exists: fs.existsSync(path.join(__dirname, '../dist')),
      worker_script_exists: fs.existsSync(path.join(__dirname, '../dist/scripts/start-worker.js')),
      package_json_exists: fs.existsSync(path.join(__dirname, '../package.json')),
      current_directory: process.cwd(),
      __dirname: __dirname
    };

    const totalDuration = Date.now() - startTime;

    const response = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      duration: totalDuration,
      environment: envStatus,
      temporal: temporalStatus,
      filesystem: fileSystemStatus,
      process: {
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        uptime: process.uptime(),
        memoryUsage: process.memoryUsage()
      }
    };

    console.log('=== Status check completed ===');
    console.log('Response summary:', {
      temporalConnected: temporalStatus.connected,
      schedulesFound: temporalStatus.schedules?.length || 0,
      hasError: !!temporalStatus.error,
      duration: totalDuration
    });

    res.status(200).json(response);

  } catch (error) {
    const duration = Date.now() - startTime;
    
    console.error('=== Status endpoint error ===');
    console.error('Error details:', {
      message: error.message,
      stack: error.stack,
      duration: duration
    });

    res.status(500).json({
      status: 'error',
      error: error.message,
      timestamp: new Date().toISOString(),
      duration: duration
    });
  }
};

async function checkTemporalConnection() {
  try {
    // We'll use a dynamic import to avoid issues with ES modules vs CommonJS
    const { Connection } = await import('@temporalio/client');
    
    const address = process.env.TEMPORAL_SERVER_URL || 'localhost:7233';
    
    // Configure connection options
    const connectionOptions = { address };
    
    // Add TLS and API key for remote connections (Temporal Cloud)
    if (process.env.TEMPORAL_TLS === 'true' || process.env.TEMPORAL_API_KEY) {
      connectionOptions.tls = {};
    }

    if (process.env.TEMPORAL_API_KEY) {
      connectionOptions.metadata = {
        'temporal-namespace': process.env.TEMPORAL_NAMESPACE || 'default',
      };
      connectionOptions.apiKey = process.env.TEMPORAL_API_KEY;
    }
    
    const connection = await Connection.connect(connectionOptions);
    
    // If we reach here, connection was successful
    return {
      connected: true,
      address: address,
      tls: !!connectionOptions.tls,
      hasApiKey: !!process.env.TEMPORAL_API_KEY
    };
  } catch (error) {
    return {
      connected: false,
      error: error.message
    };
  }
} 