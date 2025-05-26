require('dotenv').config();
const { Client } = require('@temporalio/client');

// Status endpoint to check if the service is running and auto-initialize schedules
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
      connection_duration: null,
      auto_initialization: {
        attempted: false,
        success: false,
        error: null
      }
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
            });
          }
          
          console.log(`Found ${temporalStatus.schedules.length} schedules`);
          
          // Auto-initialize schedules if none exist
          if (temporalStatus.schedules.length === 0) {
            console.log('🚀 No schedules found, attempting auto-initialization...');
            temporalStatus.auto_initialization.attempted = true;
            
            try {
              // Try to auto-initialize schedules
              await autoInitializeSchedules();
              temporalStatus.auto_initialization.success = true;
              console.log('✅ Auto-initialization completed successfully');
              
              // Re-check schedules after initialization
              const newSchedules = await scheduleHandle.list();
              temporalStatus.schedules = [];
              for await (const schedule of newSchedules) {
                temporalStatus.schedules.push({
                  id: schedule.scheduleId,
                });
              }
              console.log(`After auto-init: Found ${temporalStatus.schedules.length} schedules`);
              
            } catch (initError) {
              console.error('❌ Auto-initialization failed:', initError);
              temporalStatus.auto_initialization.error = initError.message;
            }
          }
          
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
      schedule_script_exists: fs.existsSync(path.join(__dirname, '../dist/scripts/create-all-schedules.js')),
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
      autoInitAttempted: temporalStatus.auto_initialization.attempted,
      autoInitSuccess: temporalStatus.auto_initialization.success,
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

// Auto-initialize schedules function
async function autoInitializeSchedules() {
  console.log('🔧 Starting auto-initialization of schedules...');
  
  const { spawn } = require('child_process');
  const path = require('path');
  
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(__dirname, '../dist/scripts/create-all-schedules.js');
    
    console.log('📄 Executing schedule creation script:', scriptPath);
    
    const child = spawn('node', [scriptPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
      timeout: 30000, // 30 second timeout for auto-init
      killSignal: 'SIGTERM'
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code, signal) => {
      console.log('🏁 Auto-init script completed:', { code, signal });
      
      if (code === 0) {
        console.log('✅ Auto-initialization successful');
        resolve({ success: true, stdout, stderr });
      } else {
        console.log('❌ Auto-initialization failed with code:', code);
        reject(new Error(`Auto-init failed with code ${code}. stderr: ${stderr}`));
      }
    });

    child.on('error', (error) => {
      console.log('💥 Auto-init script error:', error);
      reject(error);
    });
  });
}

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