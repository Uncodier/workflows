#!/usr/bin/env node

/**
 * Test API Connectivity from Temporal Environment
 * This script helps diagnose API connectivity issues
 */

import { apiService } from '../src/temporal/services/apiService.js';

async function testApiConnectivity() {
  console.log('🔍 Testing API Connectivity from Temporal Environment');
  console.log('=' .repeat(60));
  
  try {
    console.log('\n📋 Step 1: Testing basic API connectivity...');
    
    // Test a simple endpoint - even if it fails, we'll see the detailed error
    const result = await apiService.request('/health', {
      method: 'GET',
      timeout: 10000 // 10 seconds for quick test
    });
    
    console.log('✅ API connectivity test result:', result);
    
  } catch (error) {
    console.error('❌ API connectivity test failed:', error);
  }
  
  console.log('\n' + '=' .repeat(60));
  console.log('🏁 API connectivity test completed');
}

// Run the test
testApiConnectivity().catch(console.error); 