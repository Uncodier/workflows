// API endpoint to manage Temporal schedules
require('dotenv').config();

module.exports = async (req, res) => {
  const startTime = Date.now();
  
  try {
    console.log('=== Schedules endpoint called ===');
    console.log('Request details:', {
      method: req.method,
      url: req.url,
      userAgent: req.headers['user-agent'],
      isCron: req.headers['user-agent']?.includes('vercel-cron') || req.query.cron === 'true'
    });

    // If called from cron or with cron=true parameter, verify/create schedules
    const isCronCall = req.headers['user-agent']?.includes('vercel-cron') || req.query.cron === 'true';
    
    if (isCronCall) {
      return await verifyAndCreateSchedules(req, res);
    }

    // Route based on HTTP method for manual API calls
    switch (req.method) {
      case 'GET':
        return await listSchedules(req, res);
      case 'POST':
        return await createSchedule(req, res);
      case 'DELETE':
        return await deleteSchedule(req, res);
      default:
        return res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error('=== Schedule operation failed ===');
    console.error('Error details:', {
      message: error.message,
      stack: error.stack,
      duration: duration
    });
    
    return res.status(500).json({
      status: 'error',
      error: error.message,
      duration: duration,
      timestamp: new Date().toISOString()
    });
  }
};

// Verify and create schedules if they don't exist (called from cron)
async function verifyAndCreateSchedules(req, res) {
  const startTime = Date.now();
  
  try {
    console.log('=== Verifying and creating schedules ===');
    
    // Log all environment variables for debugging
    console.log('Environment variables check:', {
      TEMPORAL_SERVER_URL: process.env.TEMPORAL_SERVER_URL ? 'SET' : 'NOT_SET',
      TEMPORAL_NAMESPACE: process.env.TEMPORAL_NAMESPACE ? 'SET' : 'NOT_SET',
      TEMPORAL_API_KEY: process.env.TEMPORAL_API_KEY ? 'SET' : 'NOT_SET',
      TEMPORAL_TLS: process.env.TEMPORAL_TLS,
      WORKFLOW_TASK_QUEUE: process.env.WORKFLOW_TASK_QUEUE,
      NODE_ENV: process.env.NODE_ENV,
      PWD: process.cwd()
    });
    
    // Check if we have the required environment variables
    if (!process.env.TEMPORAL_SERVER_URL || !process.env.TEMPORAL_NAMESPACE) {
      console.log('⚠️  Missing Temporal configuration, skipping schedule verification');
      console.log('Missing variables:', {
        TEMPORAL_SERVER_URL: !process.env.TEMPORAL_SERVER_URL,
        TEMPORAL_NAMESPACE: !process.env.TEMPORAL_NAMESPACE
      });
      return res.status(200).json({
        status: 'skipped',
        reason: 'Missing Temporal configuration',
        missing: {
          TEMPORAL_SERVER_URL: !process.env.TEMPORAL_SERVER_URL,
          TEMPORAL_NAMESPACE: !process.env.TEMPORAL_NAMESPACE
        },
        timestamp: new Date().toISOString()
      });
    }

    // Return immediately to prevent timeout
    res.status(200).json({
      status: 'initiated',
      message: 'Schedule verification started',
      timestamp: new Date().toISOString()
    });

    // Run schedule verification in background
    setTimeout(async () => {
      try {
        console.log('=== Starting schedule verification process ===');
        
        // Try to import and run the create-all-schedules script
        const { exec } = require('child_process');
        const path = require('path');
        const fs = require('fs');
        
        // Check if compiled script exists
        const scriptPath = path.join(__dirname, '../dist/scripts/create-all-schedules.js');
        console.log('Checking for compiled script:', {
          scriptPath: scriptPath,
          exists: fs.existsSync(scriptPath)
        });
        
        if (fs.existsSync(scriptPath)) {
          console.log('✅ Using compiled JavaScript script for schedule verification');
          console.log('Script details:', {
            path: scriptPath,
            size: fs.statSync(scriptPath).size,
            modified: fs.statSync(scriptPath).mtime.toISOString()
          });
          
          // Set up environment for the script
          const env = {
            ...process.env,
            NODE_ENV: process.env.NODE_ENV || 'production'
          };
          
          console.log('Executing script with environment:', {
            cwd: path.join(__dirname, '..'),
            env: {
              TEMPORAL_SERVER_URL: env.TEMPORAL_SERVER_URL ? 'SET' : 'NOT_SET',
              TEMPORAL_NAMESPACE: env.TEMPORAL_NAMESPACE,
              TEMPORAL_API_KEY: env.TEMPORAL_API_KEY ? 'SET' : 'NOT_SET',
              NODE_ENV: env.NODE_ENV
            }
          });
          
          exec(`node ${scriptPath}`, { 
            cwd: path.join(__dirname, '..'),
            timeout: 45000, // 45 second timeout
            env: env
          }, (error, stdout, stderr) => {
            console.log('=== Script execution completed ===');
            console.log('Execution results:', {
              hasError: !!error,
              hasStdout: !!stdout,
              hasStderr: !!stderr,
              stdoutLength: stdout ? stdout.length : 0,
              stderrLength: stderr ? stderr.length : 0
            });
            
            if (error) {
              console.error('❌ Schedule creation failed:', {
                message: error.message,
                code: error.code,
                signal: error.signal,
                killed: error.killed
              });
              console.error('stderr output:', stderr);
            } else {
              console.log('✅ Schedule creation completed successfully');
            }
            
            if (stdout) {
              console.log('stdout output:', stdout);
            }
            
            if (stderr && !error) {
              console.log('stderr (warnings):', stderr);
            }
          });
          
        } else {
          console.log('⚠️  Compiled script not found, trying TypeScript version');
          
          // Check if TypeScript source exists
          const tsScriptPath = path.join(__dirname, '../src/scripts/create-all-schedules.ts');
          console.log('Checking for TypeScript script:', {
            tsScriptPath: tsScriptPath,
            exists: fs.existsSync(tsScriptPath)
          });
          
          if (fs.existsSync(tsScriptPath)) {
            console.log('✅ Using TypeScript version with ts-node');
            
            // Try to run TypeScript version with ts-node
            exec(`npx ts-node src/scripts/create-all-schedules.ts`, {
              cwd: path.join(__dirname, '..'),
              timeout: 45000,
              env: {
                ...process.env,
                NODE_ENV: process.env.NODE_ENV || 'production'
              }
            }, (error, stdout, stderr) => {
              console.log('=== TypeScript script execution completed ===');
              console.log('TS Execution results:', {
                hasError: !!error,
                hasStdout: !!stdout,
                hasStderr: !!stderr
              });
              
              if (error) {
                console.error('❌ TypeScript schedule creation failed:', {
                  message: error.message,
                  code: error.code
                });
                console.error('TS stderr:', stderr);
              } else {
                console.log('✅ TypeScript schedule creation completed successfully');
              }
              
              if (stdout) {
                console.log('TS stdout:', stdout);
              }
            });
          } else {
            console.error('❌ Neither compiled script nor TypeScript source found');
            console.error('Available files in scripts directory:');
            try {
              const scriptsDir = path.join(__dirname, '../dist/scripts');
              if (fs.existsSync(scriptsDir)) {
                console.log('dist/scripts contents:', fs.readdirSync(scriptsDir));
              } else {
                console.log('dist/scripts directory does not exist');
              }
              
              const srcScriptsDir = path.join(__dirname, '../src/scripts');
              if (fs.existsSync(srcScriptsDir)) {
                console.log('src/scripts contents:', fs.readdirSync(srcScriptsDir));
              } else {
                console.log('src/scripts directory does not exist');
              }
            } catch (dirError) {
              console.error('Error checking directories:', dirError.message);
            }
          }
        }
        
      } catch (bgError) {
        console.error('❌ Background schedule verification failed:', {
          message: bgError.message,
          stack: bgError.stack,
          name: bgError.name
        });
      }
    }, 100);

  } catch (error) {
    const duration = Date.now() - startTime;
    console.error('❌ Schedule verification setup failed:', {
      message: error.message,
      stack: error.stack,
      duration: duration
    });
    
    return res.status(500).json({
      status: 'error',
      error: error.message,
      duration: duration,
      timestamp: new Date().toISOString()
    });
  }
}

// List all schedules
async function listSchedules(req, res) {
  try {
    console.log('=== Listing schedules ===');
    
    // Dynamically import scheduler module
    const { listSchedules } = await import('../dist/temporal/scheduler/index.js');
    const schedules = await listSchedules();
    
    console.log(`Found ${schedules.length} schedules`);
    
    return res.status(200).json({
      status: 'success',
      schedules,
      count: schedules.length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Failed to list schedules:', error);
    return res.status(500).json({ error: error.message });
  }
}

// Create a new schedule
async function createSchedule(req, res) {
  try {
    console.log('=== Creating schedule ===');
    const { scheduleName, workflowType, args, cronExpression, options } = req.body;
    
    if (!scheduleName || !workflowType || !cronExpression) {
      return res.status(400).json({
        error: 'Missing required parameters',
        required: ['scheduleName', 'workflowType', 'cronExpression'],
        optional: ['args', 'options']
      });
    }
    
    // Dynamically import scheduler module
    const { createCronSchedule } = await import('../dist/temporal/scheduler/index.js');
    
    // Create the schedule with Temporal
    const scheduleId = await createCronSchedule(
      scheduleName,
      workflowType,
      args || [],
      cronExpression,
      options
    );
    
    console.log(`Schedule created successfully: ${scheduleId}`);
    
    return res.status(201).json({
      status: 'success',
      schedule: {
        id: scheduleId,
        name: scheduleName,
        workflowType,
        cronExpression,
        args: args || []
      }
    });
  } catch (error) {
    console.error('Failed to create schedule:', error);
    return res.status(500).json({ error: error.message });
  }
}

// Delete a schedule
async function deleteSchedule(req, res) {
  try {
    console.log('=== Deleting schedule ===');
    const scheduleId = req.query.scheduleId;
    
    if (!scheduleId) {
      return res.status(400).json({
        error: 'Missing required parameter',
        required: ['scheduleId']
      });
    }
    
    // Dynamically import scheduler module
    const { deleteSchedule } = await import('../dist/temporal/scheduler/index.js');
    
    // Delete the schedule from Temporal
    await deleteSchedule(scheduleId);
    
    console.log(`Schedule deleted successfully: ${scheduleId}`);
    
    return res.status(200).json({
      status: 'success',
      message: `Schedule ${scheduleId} deleted successfully`,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Failed to delete schedule:', error);
    return res.status(500).json({ error: error.message });
  }
} 