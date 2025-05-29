/**
 * Debug script to test Supabase connection and view data
 */

import { getSupabaseService } from '../src/temporal/services/supabaseService';

async function debugSupabase() {
  console.log('🔍 Supabase Debug Script');
  console.log('======================');

  try {
    const supabaseService = getSupabaseService();
    
    console.log('\n1. Testing connection...');
    const isConnected = await supabaseService.getConnectionStatus();
    console.log(`   Connection status: ${isConnected ? '✅ Connected' : '❌ Failed'}`);
    
    if (!isConnected) {
      console.log('   Cannot proceed without connection');
      return;
    }

    console.log('\n2. Querying sites table...');
    try {
      const sites = await supabaseService.fetchSites();
      console.log(`   Found ${sites.length} sites:`);
      sites.forEach((site, index) => {
        console.log(`   ${index + 1}. ${site.name || 'Unnamed'} (${site.id})`);
        console.log(`      URL: ${site.url || 'No URL'}`);
        console.log(`      User ID: ${site.user_id || 'No user_id'}`);
        console.log(`      Created: ${site.created_at || 'No date'}`);
      });
    } catch (error) {
      console.error('   ❌ Error querying sites:', error instanceof Error ? error.message : String(error));
    }

    console.log('\n3. Querying settings table...');
    try {
      // Get all settings regardless of site_id
      const settingsResult = await supabaseService['client']
        .from('settings')
        .select('*')
        .limit(10);

      if (settingsResult.error) {
        console.error('   ❌ Error querying settings:', settingsResult.error.message);
      } else {
        console.log(`   Found ${settingsResult.data?.length || 0} settings records:`);
        settingsResult.data?.forEach((setting, index) => {
          console.log(`   ${index + 1}. Site ID: ${setting.site_id}`);
          console.log(`      Has channels: ${!!setting.channels}`);
          if (setting.channels && typeof setting.channels === 'object') {
            console.log(`      Channels keys: ${Object.keys(setting.channels).join(', ')}`);
          }
        });
      }
    } catch (error) {
      console.error('   ❌ Error querying settings:', error instanceof Error ? error.message : String(error));
    }

    console.log('\n4. Querying cron_status table...');
    try {
      const cronResult = await supabaseService['client']
        .from('cron_status')
        .select('*')
        .limit(10);

      if (cronResult.error) {
        console.error('   ❌ Error querying cron_status:', cronResult.error.message);
      } else {
        console.log(`   Found ${cronResult.data?.length || 0} cron status records:`);
        cronResult.data?.forEach((cron, index) => {
          console.log(`   ${index + 1}. Site ID: ${cron.site_id}, Activity: ${cron.activity_name}, Status: ${cron.status}`);
        });
      }
    } catch (error) {
      console.error('   ❌ Error querying cron_status:', error instanceof Error ? error.message : String(error));
    }

  } catch (error) {
    console.error('❌ Error in debug script:', error);
  }
}

// Run the debug script
debugSupabase().then(() => {
  console.log('\n✅ Debug script completed');
  process.exit(0);
}).catch((error) => {
  console.error('❌ Debug script failed:', error);
  process.exit(1);
}); 