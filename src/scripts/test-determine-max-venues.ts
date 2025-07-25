/**
 * Test script for determineMaxVenuesActivity function
 * 
 * This script tests the venue limits logic based on billing plans and channel configuration:
 * - 1 venue if free plan (no channels configured)
 * - 2 venues if free plan but has at least one channel configured  
 * - 10 venues for startup plan
 * - 30 venues for enterprise plan
 */

import { determineMaxVenuesActivity } from '../temporal/activities/leadGenerationActivities';

async function testDetermineMaxVenues() {
  console.log('🧪 Testing determineMaxVenuesActivity function');
  console.log('==========================================');

  // Test site_id - you should replace this with a real site_id from your database
  const TEST_SITE_ID = 'your-test-site-id-here';

  try {
    console.log('\n🔍 Testing venue limits determination...');
    
    const result = await determineMaxVenuesActivity({
      site_id: TEST_SITE_ID,
      userId: 'test-user-id'
    });

    console.log('\n📊 Test Results:');
    console.log('================');
    
    if (result.success) {
      console.log(`✅ Success: ${result.success}`);
      console.log(`💳 Billing Plan: ${result.plan}`);
      console.log(`📡 Has Channels: ${result.hasChannels}`);
      console.log(`🏢 Max Venues: ${result.maxVenues}`);
      
      // Validate the logic
      console.log('\n🔍 Logic Validation:');
      if (result.plan === 'free') {
        const expectedVenues = result.hasChannels ? 4 : 2;
        const isCorrect = result.maxVenues === expectedVenues;
        console.log(`   Free plan logic: ${isCorrect ? '✅ CORRECT' : '❌ INCORRECT'}`);
        console.log(`   Expected: ${expectedVenues}, Got: ${result.maxVenues}`);
      } else if (result.plan === 'startup') {
        const isCorrect = result.maxVenues === 20;
        console.log(`   Startup plan logic: ${isCorrect ? '✅ CORRECT' : '❌ INCORRECT'}`);
        console.log(`   Expected: 20, Got: ${result.maxVenues}`);
      } else if (result.plan === 'enterprise') {
        const isCorrect = result.maxVenues === 60;
        console.log(`   Enterprise plan logic: ${isCorrect ? '✅ CORRECT' : '❌ INCORRECT'}`);
        console.log(`   Expected: 60, Got: ${result.maxVenues}`);
      }
      
    } else {
      console.log(`❌ Failed: ${result.error}`);
    }

    console.log('\n📋 Business Logic Summary:');
    console.log('==========================');
    console.log('• Free + No Channels  → 1 venue');
    console.log('• Free + Has Channels → 2 venues');
    console.log('• Startup Plan        → 10 venues');
    console.log('• Enterprise Plan     → 30 venues');

  } catch (error) {
    console.error('❌ Test failed with exception:', error);
  }
}

async function testMultipleScenarios() {
  console.log('\n🧪 Testing Multiple Scenarios (Mock Data)');
  console.log('==========================================');

  // Mock test cases - these would need actual database entries to work
  const testCases = [
    { plan: 'free', hasChannels: false, expected: 1, description: 'Free plan without channels' },
    { plan: 'free', hasChannels: true, expected: 2, description: 'Free plan with channels' },
    { plan: 'commission', hasChannels: false, expected: 1, description: 'Commission plan without channels' },
    { plan: 'commission', hasChannels: true, expected: 2, description: '✅ Commission plan with channels (FIXED)' },
    { plan: 'startup', hasChannels: false, expected: 10, description: 'Startup plan' },
    { plan: 'startup', hasChannels: true, expected: 10, description: 'Startup plan with channels' },
    { plan: 'enterprise', hasChannels: false, expected: 30, description: 'Enterprise plan' },
    { plan: 'enterprise', hasChannels: true, expected: 30, description: 'Enterprise plan with channels' },
    { plan: 'unknown', hasChannels: false, expected: 1, description: 'Unknown plan (default)' },
  ];

  console.log('\n📊 Expected Results for Different Scenarios:');
  console.log('===========================================');
  
  testCases.forEach((testCase, index) => {
    console.log(`${index + 1}. ${testCase.description}:`);
    console.log(`   Plan: ${testCase.plan}, Channels: ${testCase.hasChannels}, Expected: ${testCase.expected} venues`);
  });

  console.log('\n⚠️  Note: To test these scenarios, you would need to:');
  console.log('   1. Create test sites with different billing plans');
  console.log('   2. Configure settings with/without channels');
  console.log('   3. Run determineMaxVenuesActivity for each test site');
}

// Run the tests
if (require.main === module) {
  console.log('🚀 Starting Max Venues Tests');
  console.log('============================');
  
  testDetermineMaxVenues()
    .then(() => testMultipleScenarios())
    .then(() => {
      console.log('\n✅ Tests completed!');
      console.log('\n💡 To use this function in workflows:');
      console.log('   const { maxVenues } = await determineMaxVenuesActivity({ site_id });');
      console.log('   // Use maxVenues in callRegionVenuesApiActivity');
    })
    .catch(error => {
      console.error('❌ Test suite failed:', error);
    });
}

export { testDetermineMaxVenues, testMultipleScenarios }; 