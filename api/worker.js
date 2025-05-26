// This file serves as the entry point for Vercel serverless functions
require('dotenv').config();
const path = require('path');

// Global worker instance to prevent multiple workers
let workerInstance = null;
let isStarting = false;
let lastError = null;

module.exports = async (req, res) => {
  const startTime = Date.now();
  
  try {
    console.log('=== Worker serverless function triggered ===');
    console.log('Request details:', {
      method: req.method,
      url: req.url,
      headers: req.headers,
      timestamp: new Date().toISOString()
    });
    
    console.log('Environment check:', {
      NODE_ENV: process.env.NODE_ENV,
      TEMPORAL_SERVER_URL: process.env.TEMPORAL_SERVER_URL ? 'SET' : 'NOT_SET',
      TEMPORAL_NAMESPACE: process.env.TEMPORAL_NAMESPACE || 'default',
      TEMPORAL_API_KEY: process.env.TEMPORAL_API_KEY ? 'SET' : 'NOT_SET',
      TEMPORAL_TLS: process.env.TEMPORAL_TLS,
      WORKFLOW_TASK_QUEUE: process.env.WORKFLOW_TASK_QUEUE || 'default',
      VERCEL: process.env.VERCEL ? 'SET' : 'NOT_SET',
      PWD: process.cwd(),
      __dirname: __dirname
    });

    // Check if required files exist
    const distPath = path.join(__dirname, '../dist/scripts/start-worker.js');
    const fs = require('fs');
    
    console.log('File system check:', {
      distPath: distPath,
      distExists: fs.existsSync(distPath),
      distDir: fs.existsSync(path.join(__dirname, '../dist')),
      scriptsDir: fs.existsSync(path.join(__dirname, '../dist/scripts')),
      currentDir: fs.readdirSync(__dirname),
      parentDir: fs.existsSync(path.join(__dirname, '..')) ? fs.readdirSync(path.join(__dirname, '..')) : 'NOT_EXISTS'
    });

    // Return immediately to prevent timeout
    res.status(200).json({ 
      status: 'Worker process initiated',
      timestamp: new Date().toISOString(),
      workerRunning: !!workerInstance,
      isStarting: isStarting,
      lastError: lastError ? lastError.message : null,
      environment: {
        NODE_ENV: process.env.NODE_ENV,
        VERCEL: !!process.env.VERCEL,
        hasTemporalConfig: !!(process.env.TEMPORAL_SERVER_URL && process.env.TEMPORAL_NAMESPACE)
      }
    });

    // If worker is already running or starting, don't start another
    if (workerInstance || isStarting) {
      console.log('Worker already running or starting, skipping...', {
        workerInstance: !!workerInstance,
        isStarting: isStarting
      });
      return;
    }

    isStarting = true;
    lastError = null;

    // Import and start worker in background
    setTimeout(async () => {
      try {
        console.log('=== Attempting to load worker module ===');
        console.log('Module path:', distPath);
        
        // Try to require the module
        const startWorkerModule = require('../dist/scripts/start-worker');
        console.log('Worker module loaded successfully:', {
          moduleType: typeof startWorkerModule,
          moduleKeys: Object.keys(startWorkerModule || {}),
          hasRun: typeof startWorkerModule?.run === 'function',
          hasStartWorker: typeof startWorkerModule?.startWorker === 'function'
        });

        // Try to execute the worker
        if (startWorkerModule && typeof startWorkerModule.run === 'function') {
          console.log('Executing worker.run()...');
          const result = await startWorkerModule.run();
          console.log('Worker run completed:', {
            resultType: typeof result,
            hasWorker: !!(result && result.worker),
            hasRunPromise: !!(result && result.runPromise)
          });
          workerInstance = result;
        } else if (startWorkerModule && typeof startWorkerModule.startWorker === 'function') {
          console.log('Executing startWorker()...');
          const result = await startWorkerModule.startWorker();
          console.log('StartWorker completed:', {
            resultType: typeof result,
            hasWorker: !!(result && result.worker)
          });
          workerInstance = result;
        } else {
          throw new Error('No valid worker function found in module');
        }

        isStarting = false;
        console.log('=== Worker startup completed successfully ===');
        
      } catch (error) {
        console.error('=== Worker startup failed ===');
        console.error('Error details:', {
          message: error.message,
          stack: error.stack,
          name: error.name,
          code: error.code
        });
        
        lastError = error;
        isStarting = false;
        workerInstance = null;
      }
    }, 100);

  } catch (error) {
    const duration = Date.now() - startTime;
    console.error('=== Failed to initialize worker ===');
    console.error('Error details:', {
      message: error.message,
      stack: error.stack,
      name: error.name,
      duration: duration
    });
    
    lastError = error;
    
    res.status(500).json({ 
      error: 'Failed to initialize worker',
      message: error.message,
      duration: duration,
      timestamp: new Date().toISOString()
    });
  }
}; 