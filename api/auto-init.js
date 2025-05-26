// Auto-initialization endpoint for schedules
require('dotenv').config();
const { spawn } = require('child_process');
const path = require('path');

export default async function handler(req, res) {
  console.log('=== AUTO-INIT ENDPOINT CALLED ===');
  console.log('Timestamp:', new Date().toISOString());
  console.log('Method:', req.method);
  console.log('User-Agent:', req.headers['user-agent']);
  console.log('Is Cron:', req.headers['user-agent']?.includes('vercel-cron'));

  // Allow both GET and POST
  if (!['GET', 'POST'].includes(req.method)) {
    return res.status(405).json({ 
      error: 'Method not allowed',
      allowedMethods: ['GET', 'POST'],
      receivedMethod: req.method
    });
  }

  // Check environment
  const requiredEnvVars = [
    'TEMPORAL_SERVER_URL',
    'TEMPORAL_NAMESPACE', 
    'TEMPORAL_API_KEY'
  ];

  const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
  if (missingVars.length > 0) {
    console.log('❌ Missing required environment variables:', missingVars);
    return res.status(500).json({
      error: 'Missing required environment variables',
      missingVariables: missingVars,
      requiredVariables: requiredEnvVars
    });
  }

  try {
    console.log('🚀 Starting auto-initialization...');
    
    // First, check if schedules already exist
    const existingSchedules = await checkExistingSchedules();
    console.log(`📊 Found ${existingSchedules.length} existing schedules`);
    
    if (existingSchedules.length >= 3) {
      console.log('✅ Sufficient schedules already exist, no action needed');
      return res.status(200).json({
        success: true,
        action: 'none_needed',
        message: 'Schedules already exist',
        existing_schedules: existingSchedules.length,
        timestamp: new Date().toISOString()
      });
    }

    // Create missing schedules
    console.log('🔧 Creating missing schedules...');
    const result = await createSchedules();
    
    console.log('✅ Auto-initialization completed');
    return res.status(200).json({
      success: true,
      action: 'schedules_created',
      message: 'Auto-initialization completed successfully',
      result: result,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('💥 Auto-initialization failed:', error);
    return res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
}

// Check existing schedules
async function checkExistingSchedules() {
  try {
    const { Client } = require('@temporalio/client');
    
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

    const scheduleHandle = client.schedule;
    const schedules = await scheduleHandle.list();
    
    const scheduleList = [];
    for await (const schedule of schedules) {
      scheduleList.push(schedule.scheduleId);
    }
    
    return scheduleList;
  } catch (error) {
    console.log('⚠️ Could not check existing schedules:', error.message);
    return []; // Assume no schedules if we can't check
  }
}

// Create schedules using the script
async function createSchedules() {
  console.log('📄 Executing schedule creation script...');
  
  const scriptPath = path.join(process.cwd(), 'dist', 'scripts', 'create-all-schedules.js');
  
  // Check if script exists
  const fs = require('fs');
  if (!fs.existsSync(scriptPath)) {
    throw new Error(`Schedule creation script not found at: ${scriptPath}`);
  }

  return new Promise((resolve, reject) => {
    const child = spawn('node', [scriptPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
      timeout: 45000, // 45 second timeout
      killSignal: 'SIGTERM'
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      const output = data.toString();
      stdout += output;
      console.log('📤 SCRIPT:', output.trim());
    });

    child.stderr.on('data', (data) => {
      const output = data.toString();
      stderr += output;
      console.log('📤 SCRIPT ERROR:', output.trim());
    });

    child.on('close', (code, signal) => {
      console.log('🏁 Script completed:', { code, signal });
      
      if (code === 0) {
        resolve({
          success: true,
          exitCode: code,
          signal,
          stdout: stdout.trim(),
          stderr: stderr.trim()
        });
      } else {
        reject(new Error(`Script failed with code ${code}. stderr: ${stderr}`));
      }
    });

    child.on('error', (error) => {
      console.log('💥 Script execution error:', error);
      reject(error);
    });
  });
} 