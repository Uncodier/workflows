#!/usr/bin/env node

/**
 * Script de diagnóstico para API de Customer Support
 * Prueba conectividad, latencia y timeout scenarios
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');

// Configuración de prueba
const API_BASE_URL = process.env.API_BASE_URL || 'http://192.168.0.61:3001';
const TEST_TIMEOUTS = [30000, 60000, 120000, 300000]; // 30s, 1m, 2m, 5m

// Datos de prueba
const TEST_PAYLOAD = {
  message: "Test message for customer support API diagnostics",
  site_id: "test-site-id",
  userId: "test-user-id", 
  lead_notification: "none",
  origin: "diagnostic_test",
  visitor_id: "test-visitor-id",
  name: "Test User",
  email: "test@example.com",
  phone: "+1234567890"
};

async function makeRequest(url, data, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const isHttps = urlObj.protocol === 'https:';
    const requestModule = isHttps ? https : http;
    
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(JSON.stringify(data))
      },
      timeout: timeout
    };

    const startTime = Date.now();
    
    const req = requestModule.request(options, (res) => {
      let responseData = '';
      
      res.on('data', (chunk) => {
        responseData += chunk;
      });
      
      res.on('end', () => {
        const duration = Date.now() - startTime;
        
        try {
          const parsedData = JSON.parse(responseData);
          resolve({
            success: res.statusCode >= 200 && res.statusCode < 300,
            statusCode: res.statusCode,
            duration,
            data: parsedData,
            headers: res.headers
          });
        } catch (e) {
          resolve({
            success: false,
            statusCode: res.statusCode,
            duration,
            data: responseData,
            headers: res.headers,
            parseError: e.message
          });
        }
      });
    });

    req.on('error', (error) => {
      const duration = Date.now() - startTime;
      reject({
        success: false,
        error: error.message,
        duration,
        type: 'request_error'
      });
    });

    req.on('timeout', () => {
      const duration = Date.now() - startTime;
      req.destroy();
      reject({
        success: false,
        error: `Request timeout after ${timeout}ms`,
        duration,
        type: 'timeout'
      });
    });

    req.write(JSON.stringify(data));
    req.end();
  });
}

async function testConnectivity() {
  console.log('🌐 Testing basic connectivity...');
  
  try {
    const healthUrl = `${API_BASE_URL}/health`;
    console.log(`📡 Testing: ${healthUrl}`);
    
    const result = await makeRequest(healthUrl, {}, 10000);
    
    if (result.success) {
      console.log('✅ Basic connectivity: OK');
      console.log(`⏱️ Health check latency: ${result.duration}ms`);
      return true;
    } else {
      console.log('❌ Basic connectivity: FAILED');
      console.log(`❌ Status: ${result.statusCode}`);
      return false;
    }
  } catch (error) {
    console.log('❌ Basic connectivity: FAILED');
    console.log(`❌ Error: ${error.error || error.message}`);
    return false;
  }
}

async function testCustomerSupportEndpoint(timeout) {
  console.log(`\n🎯 Testing customer support endpoint (timeout: ${timeout}ms)...`);
  
  const url = `${API_BASE_URL}/api/agents/customerSupport/message`;
  console.log(`📡 Testing: ${url}`);
  
  try {
    const result = await makeRequest(url, TEST_PAYLOAD, timeout);
    
    console.log(`⏱️ Duration: ${result.duration}ms`);
    console.log(`📊 Status: ${result.statusCode}`);
    
    if (result.success) {
      console.log('✅ Customer support API: OK');
      console.log('📋 Response preview:', JSON.stringify(result.data, null, 2).substring(0, 200) + '...');
    } else {
      console.log('❌ Customer support API: FAILED');
      console.log('📋 Response:', JSON.stringify(result.data, null, 2));
    }
    
    return result;
    
  } catch (error) {
    console.log(`❌ Customer support API: ${error.type?.toUpperCase() || 'FAILED'}`);
    console.log(`⏱️ Duration: ${error.duration}ms`);
    console.log(`❌ Error: ${error.error}`);
    
    return error;
  }
}

async function analyzeResults(results) {
  console.log('\n📊 ANALYSIS RESULTS');
  console.log('='.repeat(50));
  
  const successful = results.filter(r => r.success);
  const timeouts = results.filter(r => r.type === 'timeout');
  const errors = results.filter(r => !r.success && r.type !== 'timeout');
  
  console.log(`✅ Successful: ${successful.length}/${results.length}`);
  console.log(`⏰ Timeouts: ${timeouts.length}/${results.length}`);
  console.log(`❌ Other errors: ${errors.length}/${results.length}`);
  
  if (successful.length > 0) {
    const avgDuration = successful.reduce((sum, r) => sum + r.duration, 0) / successful.length;
    const maxDuration = Math.max(...successful.map(r => r.duration));
    const minDuration = Math.min(...successful.map(r => r.duration));
    
    console.log(`\n⏱️ PERFORMANCE METRICS (successful calls):`);
    console.log(`   Average: ${avgDuration.toFixed(0)}ms`);
    console.log(`   Min: ${minDuration}ms`);
    console.log(`   Max: ${maxDuration}ms`);
    
    if (avgDuration > 120000) { // > 2 minutes
      console.log('🚨 WARNING: API responses are very slow (>2min average)');
      console.log('💡 Consider: API optimization, server resources, or increase timeouts');
    } else if (avgDuration > 60000) { // > 1 minute
      console.log('⚠️ NOTICE: API responses are slow (>1min average)');
      console.log('💡 Consider: Monitoring API performance or increasing timeouts to 5+ minutes');
    } else {
      console.log('✅ API performance looks normal');
    }
  }
  
  if (timeouts.length > 0) {
    console.log('\n🚨 TIMEOUT RECOMMENDATIONS:');
    console.log('   Current Temporal timeout: 5 minutes');
    
    const longestAttempt = Math.max(...timeouts.map(r => r.duration));
    const recommendedTimeout = Math.ceil(longestAttempt * 1.5 / 60000); // 1.5x margin in minutes
    
    if (recommendedTimeout > 5) {
      console.log(`   Recommended: ${recommendedTimeout} minutes`);
      console.log(`   Update in: src/temporal/config/timeouts.ts`);
    }
  }
}

async function main() {
  console.log('🔍 Customer Support API Diagnostics');
  console.log('='.repeat(50));
  
  // Test basic connectivity first
  const isConnected = await testConnectivity();
  
  if (!isConnected) {
    console.log('\n❌ Cannot proceed - basic connectivity failed');
    console.log('💡 Check: Network, API server status, firewall');
    process.exit(1);
  }
  
  // Test customer support endpoint with different timeouts
  const results = [];
  
  for (const timeout of TEST_TIMEOUTS) {
    const result = await testCustomerSupportEndpoint(timeout);
    results.push(result);
    
    // If this timeout succeeded, no need to test longer ones
    if (result.success) {
      console.log(`🎯 Found working timeout: ${timeout}ms`);
      break;
    }
    
    // Wait a bit between requests
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  
  await analyzeResults(results);
  
  console.log('\n🏁 Diagnostics completed');
}

// Run diagnostics
main().catch(error => {
  console.error('💥 Diagnostic script failed:', error);
  process.exit(1);
}); 