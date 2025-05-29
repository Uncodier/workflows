/**
 * Simple test script to verify Supabase connection and email-enabled sites
 */

// Load environment variables from .env.local
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { getSupabaseService } from '../src/temporal/services/supabaseService';

async function testSupabaseConnection() {
  console.log('🔍 Testing Supabase Connection for Email-Enabled Sites');
  console.log('====================================================');

  try {
    const supabaseService = getSupabaseService();
    
    console.log('\n1. Testing connection...');
    const isConnected = await supabaseService.getConnectionStatus();
    console.log(`   Connection status: ${isConnected ? '✅ Connected' : '❌ Failed'}`);
    
    if (!isConnected) {
      console.log('   Cannot proceed without connection');
      return;
    }

    console.log('\n2. Testing new fetchSitesWithEmailEnabled method...');
    const sitesWithEmail = await supabaseService.fetchSitesWithEmailEnabled();
    console.log(`   Found ${sitesWithEmail.length} sites with email enabled:`);
    
    sitesWithEmail.forEach((site, index) => {
      console.log(`   ${index + 1}. ${site.name || 'Unnamed'} (${site.id})`);
      console.log(`      URL: ${site.url || 'No URL'}`);
      console.log(`      User ID: ${site.user_id || 'No user_id'}`);
      console.log(`      Email Settings:`, site.emailSettings);
    });

    console.log('\n3. Testing original fetchSites method for comparison...');
    const allSites = await supabaseService.fetchSites();
    console.log(`   Found ${allSites.length} total sites in database`);

  } catch (error) {
    console.error('❌ Error in test script:', error);
  }
}

// Run the test script
testSupabaseConnection().then(() => {
  console.log('\n✅ Test script completed');
  process.exit(0);
}).catch((error) => {
  console.error('❌ Test script failed:', error);
  process.exit(1);
}); 