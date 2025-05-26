// API endpoint to manage Temporal schedules
require('dotenv').config();
const { spawn } = require('child_process');
const path = require('path');

export default async function handler(req, res) {
  console.log('=== SCHEDULES ENDPOINT CALLED ===');
  console.log('Timestamp:', new Date().toISOString());
  console.log('Method:', req.method);
  console.log('Headers:', req.headers);
  console.log('Environment check:', {
    NODE_ENV: process.env.NODE_ENV,
    TEMPORAL_SERVER_URL: process.env.TEMPORAL_SERVER_URL ? 'SET' : 'NOT_SET',
    TEMPORAL_NAMESPACE: process.env.TEMPORAL_NAMESPACE || 'default',
    TEMPORAL_API_KEY: process.env.TEMPORAL_API_KEY ? 'SET' : 'NOT_SET',
    TEMPORAL_TLS: process.env.TEMPORAL_TLS,
    WORKFLOW_TASK_QUEUE: process.env.WORKFLOW_TASK_QUEUE || 'default',
    PWD: process.cwd(),
    isVercel: !!process.env.VERCEL,
    vercelEnv: process.env.VERCEL_ENV,
    vercelRegion: process.env.VERCEL_REGION
  });

  // Only allow POST requests
  if (req.method !== 'POST') {
    console.log('❌ Method not allowed:', req.method);
    return res.status(405).json({ 
      error: 'Method not allowed',
      allowedMethods: ['POST'],
      receivedMethod: req.method
    });
  }

  // Validate required environment variables
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

  console.log('✅ Environment variables validated');
  console.log('🚀 Starting schedule creation process...');

  let stdout = '';
  let stderr = '';

  try {
    // Use the main schedule creation script
    const scriptPath = path.join(process.cwd(), 'dist', 'scripts', 'create-all-schedules.js');
    console.log('📄 Script path:', scriptPath);

    // Check if the compiled script exists
    const fs = require('fs');
    if (!fs.existsSync(scriptPath)) {
      console.log('❌ Compiled script not found at:', scriptPath);
      console.log('📁 Available files in dist/scripts:');
      try {
        const distScriptsPath = path.join(process.cwd(), 'dist', 'scripts');
        const files = fs.readdirSync(distScriptsPath);
        console.log('Files:', files);
      } catch (dirError) {
        console.log('Could not read dist/scripts directory:', dirError.message);
      }
      
      return res.status(500).json({
        error: 'Compiled script not found',
        expectedPath: scriptPath,
        suggestion: 'Run npm run worker:build to compile the scripts'
      });
    }

    console.log('✅ Script file exists, executing...');

    // Execute the script with timeout
    const child = spawn('node', [scriptPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
      timeout: 50000, // 50 second timeout (less than Vercel's 60s limit)
      killSignal: 'SIGTERM'
    });

    let isCompleted = false;

    // Collect output
    child.stdout.on('data', (data) => {
      const output = data.toString();
      stdout += output;
      console.log('📤 STDOUT:', output.trim());
    });

    child.stderr.on('data', (data) => {
      const output = data.toString();
      stderr += output;
      console.log('📤 STDERR:', output.trim());
    });

    // Handle completion
    const result = await new Promise((resolve, reject) => {
      child.on('close', (code, signal) => {
        isCompleted = true;
        console.log('🏁 Process completed');
        console.log('Exit code:', code);
        console.log('Signal:', signal);
        console.log('STDOUT length:', stdout.length);
        console.log('STDERR length:', stderr.length);

        if (code === 0) {
          resolve({
            success: true,
            exitCode: code,
            signal,
            stdout: stdout.trim(),
            stderr: stderr.trim()
          });
        } else {
          reject(new Error(`Process exited with code ${code}, signal: ${signal}`));
        }
      });

      child.on('error', (error) => {
        isCompleted = true;
        console.log('💥 Process error:', error);
        reject(error);
      });

      // Additional timeout safety net
      setTimeout(() => {
        if (!isCompleted) {
          console.log('⏰ Timeout reached, killing process...');
          child.kill('SIGTERM');
          reject(new Error('Process timeout after 50 seconds'));
        }
      }, 50000);
    });

    console.log('✅ Schedule creation completed successfully');
    console.log('📊 Final result:', result);

    return res.status(200).json({
      success: true,
      message: 'Schedules created successfully',
      timestamp: new Date().toISOString(),
      result: result,
      logs: {
        stdout: result.stdout,
        stderr: result.stderr
      }
    });

  } catch (error) {
    console.log('💥 Error in schedule creation:');
    console.log('Error message:', error.message);
    console.log('Error name:', error.name);
    console.log('Error stack:', error.stack);

    return res.status(500).json({
      success: false,
      error: error.message,
      errorName: error.name,
      timestamp: new Date().toISOString(),
      logs: {
        stdout: stdout || '',
        stderr: stderr || ''
      }
    });
  }
} 