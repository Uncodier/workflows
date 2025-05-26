#!/usr/bin/env node
require('dotenv').config();

const fs = require('fs');
const path = require('path');

console.log('=== Temporal Worker Diagnostic Tool ===');
console.log('Timestamp:', new Date().toISOString());
console.log('');

// 1. Environment Variables Check
console.log('1. ENVIRONMENT VARIABLES:');
console.log('------------------------');
const requiredEnvVars = [
  'TEMPORAL_SERVER_URL',
  'TEMPORAL_NAMESPACE', 
  'TEMPORAL_API_KEY',
  'TEMPORAL_TLS',
  'WORKFLOW_TASK_QUEUE'
];

const optionalEnvVars = [
  'NODE_ENV',
  'VERCEL',
  'SUPABASE_URL',
  'SUPABASE_KEY',
  'API_BASE_URL',
  'API_KEY',
  'LOG_LEVEL'
];

console.log('Required variables:');
requiredEnvVars.forEach(varName => {
  const value = process.env[varName];
  const status = value ? '✅ SET' : '❌ NOT SET';
  console.log(`  ${varName}: ${status}`);
  if (value && varName !== 'TEMPORAL_API_KEY') {
    console.log(`    Value: ${value}`);
  }
});

console.log('\nOptional variables:');
optionalEnvVars.forEach(varName => {
  const value = process.env[varName];
  const status = value ? '✅ SET' : '⚠️  NOT SET';
  console.log(`  ${varName}: ${status}`);
  if (value) {
    console.log(`    Value: ${value}`);
  }
});

// 2. File System Check
console.log('\n2. FILE SYSTEM:');
console.log('---------------');
const filesToCheck = [
  'package.json',
  'dist/scripts/start-worker.js',
  'dist/temporal/workers/worker.js',
  'src/temporal/workers/worker.ts',
  'src/scripts/start-worker.ts',
  'api/worker.js',
  'vercel.json'
];

filesToCheck.forEach(filePath => {
  const fullPath = path.join(process.cwd(), filePath);
  const exists = fs.existsSync(fullPath);
  const status = exists ? '✅ EXISTS' : '❌ MISSING';
  console.log(`  ${filePath}: ${status}`);
  
  if (exists) {
    const stats = fs.statSync(fullPath);
    console.log(`    Size: ${stats.size} bytes, Modified: ${stats.mtime.toISOString()}`);
  }
});

// 3. Dependencies Check
console.log('\n3. DEPENDENCIES:');
console.log('----------------');
try {
  const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  const temporalDeps = Object.entries(packageJson.dependencies || {})
    .filter(([name]) => name.includes('temporal'));
  
  console.log('Temporal dependencies:');
  temporalDeps.forEach(([name, version]) => {
    console.log(`  ${name}: ${version}`);
  });
  
  // Check if dependencies are installed
  const nodeModulesPath = path.join(process.cwd(), 'node_modules');
  if (fs.existsSync(nodeModulesPath)) {
    console.log('\n✅ node_modules directory exists');
    
    temporalDeps.forEach(([name]) => {
      const depPath = path.join(nodeModulesPath, name);
      const installed = fs.existsSync(depPath);
      const status = installed ? '✅ INSTALLED' : '❌ NOT INSTALLED';
      console.log(`  ${name}: ${status}`);
    });
  } else {
    console.log('\n❌ node_modules directory missing');
  }
} catch (error) {
  console.log('❌ Error reading package.json:', error.message);
}

// 4. Temporal Connection Test
console.log('\n4. TEMPORAL CONNECTION:');
console.log('-----------------------');

async function testTemporalConnection() {
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

    console.log('Attempting connection with options:');
    console.log(`  Address: ${connectionOptions.address}`);
    console.log(`  TLS: ${!!connectionOptions.tls}`);
    console.log(`  API Key: ${!!connectionOptions.apiKey}`);
    console.log(`  Namespace: ${process.env.TEMPORAL_NAMESPACE}`);

    const startTime = Date.now();
    const client = new Client({
      connection: connectionOptions,
      namespace: process.env.TEMPORAL_NAMESPACE,
    });

    const duration = Date.now() - startTime;
    console.log(`✅ Connection successful (${duration}ms)`);

    // Try to list schedules
    try {
      const schedules = await client.schedule.list();
      const scheduleList = [];
      for await (const schedule of schedules) {
        scheduleList.push(schedule.scheduleId);
      }
      console.log(`✅ Found ${scheduleList.length} schedules:`, scheduleList);
    } catch (scheduleError) {
      console.log('⚠️  Could not list schedules:', scheduleError.message);
    }

  } catch (error) {
    console.log('❌ Connection failed:', error.message);
    console.log('Error details:', {
      name: error.name,
      code: error.code,
      stack: error.stack?.split('\n')[0]
    });
  }
}

// 5. Worker Module Test
console.log('\n5. WORKER MODULE:');
console.log('-----------------');

async function testWorkerModule() {
  try {
    // Test if we can load the compiled worker
    const workerPath = path.join(process.cwd(), 'dist/scripts/start-worker.js');
    if (fs.existsSync(workerPath)) {
      console.log('✅ Compiled worker script exists');
      
      try {
        const workerModule = require(workerPath);
        console.log('✅ Worker module loaded successfully');
        console.log('Module exports:', Object.keys(workerModule));
        
        if (typeof workerModule.run === 'function') {
          console.log('✅ run() function available');
        } else {
          console.log('⚠️  run() function not found');
        }
        
        if (typeof workerModule.startWorker === 'function') {
          console.log('✅ startWorker() function available');
        } else {
          console.log('⚠️  startWorker() function not found');
        }
        
      } catch (requireError) {
        console.log('❌ Error loading worker module:', requireError.message);
      }
    } else {
      console.log('❌ Compiled worker script missing');
    }
    
    // Test TypeScript source
    const tsWorkerPath = path.join(process.cwd(), 'src/scripts/start-worker.ts');
    if (fs.existsSync(tsWorkerPath)) {
      console.log('✅ TypeScript worker source exists');
    } else {
      console.log('❌ TypeScript worker source missing');
    }
    
  } catch (error) {
    console.log('❌ Worker module test failed:', error.message);
  }
}

// Run all tests
async function runDiagnostics() {
  if (process.env.TEMPORAL_SERVER_URL && process.env.TEMPORAL_NAMESPACE) {
    await testTemporalConnection();
  } else {
    console.log('⚠️  Skipping connection test - missing required environment variables');
  }
  
  await testWorkerModule();
  
  console.log('\n=== DIAGNOSTIC COMPLETE ===');
  console.log('If you see any ❌ or ⚠️  items above, those need to be addressed.');
  console.log('');
}

runDiagnostics().catch(console.error); 