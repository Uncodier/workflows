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
    
    // Check if we have the required environment variables
    if (!process.env.TEMPORAL_SERVER_URL || !process.env.TEMPORAL_NAMESPACE) {
      console.log('⚠️  Missing Temporal configuration, skipping schedule verification');
      return res.status(200).json({
        status: 'skipped',
        reason: 'Missing Temporal configuration',
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
        
        // Check if compiled script exists
        const scriptPath = path.join(__dirname, '../dist/scripts/create-all-schedules.js');
        const fs = require('fs');
        
        if (fs.existsSync(scriptPath)) {
          console.log('Using compiled JavaScript script');
          
          exec(`node ${scriptPath}`, { 
            cwd: path.join(__dirname, '..'),
            timeout: 45000 // 45 second timeout
          }, (error, stdout, stderr) => {
            if (error) {
              console.error('Schedule creation failed:', error);
              console.error('stderr:', stderr);
            } else {
              console.log('Schedule creation completed successfully');
              console.log('stdout:', stdout);
            }
          });
          
        } else {
          console.log('Compiled script not found, trying TypeScript version');
          
          // Try to run TypeScript version with ts-node
          exec(`npx ts-node src/scripts/create-all-schedules.ts`, {
            cwd: path.join(__dirname, '..'),
            timeout: 45000
          }, (error, stdout, stderr) => {
            if (error) {
              console.error('TypeScript schedule creation failed:', error);
              console.error('stderr:', stderr);
            } else {
              console.log('TypeScript schedule creation completed successfully');
              console.log('stdout:', stdout);
            }
          });
        }
        
      } catch (bgError) {
        console.error('Background schedule verification failed:', bgError);
      }
    }, 100);

  } catch (error) {
    const duration = Date.now() - startTime;
    console.error('Schedule verification setup failed:', error);
    
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