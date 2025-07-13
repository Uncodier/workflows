#!/usr/bin/env node

/**
 * Diagnose Friday Execution Issue
 * This script investigates why operations ran on Friday when they shouldn't have
 * without proper business_hours configuration.
 */

import { config } from 'dotenv';
import { getSupabaseService } from '../dist/temporal/services/supabaseService.js';

// Load environment variables from .env.local
config({ path: '.env.local' });

async function diagnoseFridayExecution() {
  console.log('🔍 DIAGNOSING FRIDAY EXECUTION ISSUE');
  console.log('=====================================');
  
  try {
    // Test 1: Check Supabase connection
    console.log('\n📡 Test 1: Checking Supabase connection...');
    const supabaseService = getSupabaseService();
    const isConnected = await supabaseService.getConnectionStatus();
    
    console.log(`   Connection Status: ${isConnected ? '✅ CONNECTED' : '❌ DISCONNECTED'}`);
    
    if (!isConnected) {
      console.log('   ⚠️  Database not connected - this triggers FALLBACK LOGIC');
      console.log('   ⚠️  Fallback logic executes on ALL weekdays (Mon-Fri) including Friday');
      console.log('   ⚠️  THIS IS LIKELY THE CAUSE OF THE FRIDAY EXECUTION');
      return;
    }
    
    // Test 2: Check sites in database
    console.log('\n🏢 Test 2: Checking sites in database...');
    const sites = await supabaseService.fetchSites();
    console.log(`   Found ${sites.length} sites in database`);
    
    if (sites.length === 0) {
      console.log('   ⚠️  No sites found - this would cause fallback logic');
      console.log('   ⚠️  Fallback logic executes on ALL weekdays (Mon-Fri) including Friday');
      return;
    }
    
    // Test 3: Check settings and business_hours
    console.log('\n⚙️  Test 3: Checking sites business hours configuration...');
    const siteIds = sites.map(site => site.id);
    const settings = await supabaseService.fetchCompleteSettings(siteIds);
    console.log(`   Found ${settings.length} settings records`);
    
    // Analyze each site's business hours
    const sitesWithBusinessHours = [];
    const sitesWithoutBusinessHours = [];
    
    for (const setting of settings) {
      const businessHours = setting.business_hours;
      const siteId = setting.site_id;
      
      if (!businessHours) {
        sitesWithoutBusinessHours.push({ siteId, reason: 'No business_hours field' });
        continue;
      }
      
      // Check if business_hours is properly structured
      let isValidBusinessHours = false;
      
      // New structure: business_hours is an array of schedule objects
      if (Array.isArray(businessHours) && businessHours.length > 0) {
        const firstSchedule = businessHours[0];
        if (firstSchedule && 
            firstSchedule.days && 
            typeof firstSchedule.days === 'object' &&
            Object.keys(firstSchedule.days).length > 0) {
          isValidBusinessHours = true;
          sitesWithBusinessHours.push({
            siteId,
            businessHours: firstSchedule.days,
            timezone: firstSchedule.timezone,
            name: firstSchedule.name
          });
        }
      }
      
      // Old structure: business_hours is a direct object with day keys
      if (!isValidBusinessHours && 
          typeof businessHours === 'object' && 
          !Array.isArray(businessHours) &&
          Object.keys(businessHours).length > 0) {
        isValidBusinessHours = true;
        sitesWithBusinessHours.push({
          siteId,
          businessHours: businessHours,
          timezone: 'Unknown',
          name: 'Legacy format'
        });
      }
      
      if (!isValidBusinessHours) {
        sitesWithoutBusinessHours.push({ 
          siteId, 
          reason: 'Invalid business_hours structure',
          data: businessHours
        });
      }
    }
    
    console.log(`   📊 Sites with valid business_hours: ${sitesWithBusinessHours.length}`);
    console.log(`   📊 Sites without valid business_hours: ${sitesWithoutBusinessHours.length}`);
    
    // Test 4: Check Friday configuration specifically
    console.log('\n📅 Test 4: Checking Friday configuration...');
    const fridayOpenSites = [];
    const fridayClosedSites = [];
    
    for (const site of sitesWithBusinessHours) {
      const fridayConfig = site.businessHours.friday;
      
      if (!fridayConfig) {
        fridayClosedSites.push({
          siteId: site.siteId,
          reason: 'No Friday configuration'
        });
        continue;
      }
      
      const isOpen = fridayConfig.enabled !== false && 
                     fridayConfig.open && 
                     fridayConfig.close && 
                     fridayConfig.open !== fridayConfig.close;
      
      if (isOpen) {
        fridayOpenSites.push({
          siteId: site.siteId,
          hours: `${fridayConfig.open} - ${fridayConfig.close}`,
          enabled: fridayConfig.enabled,
          timezone: site.timezone
        });
      } else {
        fridayClosedSites.push({
          siteId: site.siteId,
          reason: fridayConfig.enabled === false ? 'Disabled' : 'Invalid hours',
          config: fridayConfig
        });
      }
    }
    
    console.log(`   📊 Sites open on Friday: ${fridayOpenSites.length}`);
    console.log(`   📊 Sites closed on Friday: ${fridayClosedSites.length}`);
    
    // Test 5: Simulate Friday evaluation
    console.log('\n🎯 Test 5: Simulating Friday evaluation (Day 5)...');
    console.log('   This simulates what evaluateBusinessHoursForDay would return for Friday');
    
    // Simulate the main decision logic
    const totalSitesWithBusinessHours = sitesWithBusinessHours.length;
    const sitesOpenOnFriday = fridayOpenSites.length;
    
    let shouldExecuteOperations = false;
    let reason = '';
    
    if (totalSitesWithBusinessHours === 0) {
      // No sites have business_hours, use fallback logic
      shouldExecuteOperations = true; // Friday is a weekday (1-5)
      reason = 'Weekday (fallback for sites without business_hours)';
    } else if (sitesOpenOnFriday > 0) {
      shouldExecuteOperations = true;
      reason = `${sitesOpenOnFriday} site(s) have business hours on Friday`;
    } else {
      shouldExecuteOperations = false;
      reason = 'Sites with business_hours are closed on Friday';
    }
    
    console.log(`   🎯 Decision: ${shouldExecuteOperations ? '✅ EXECUTE' : '❌ SKIP'}`);
    console.log(`   🎯 Reason: ${reason}`);
    
    // Final diagnosis
    console.log('\n🔍 DIAGNOSIS SUMMARY');
    console.log('===================');
    
    if (!isConnected) {
      console.log('❌ PROBLEM FOUND: Database connection failed');
      console.log('   📋 Impact: Triggers fallback logic that executes on ALL weekdays');
      console.log('   🔧 Solution: Fix database connection credentials');
    } else if (sites.length === 0) {
      console.log('❌ PROBLEM FOUND: No sites in database');
      console.log('   📋 Impact: Triggers fallback logic that executes on ALL weekdays');
      console.log('   🔧 Solution: Ensure sites are properly configured in database');
    } else if (totalSitesWithBusinessHours === 0) {
      console.log('❌ PROBLEM FOUND: No sites have valid business_hours configuration');
      console.log('   📋 Impact: Triggers fallback logic that executes on ALL weekdays');
      console.log('   🔧 Solution: Configure business_hours for sites that need them');
    } else if (shouldExecuteOperations) {
      console.log('✅ WORKING AS EXPECTED: Some sites are configured to work on Friday');
      console.log('   📋 Sites open on Friday:');
      fridayOpenSites.forEach(site => {
        console.log(`      • Site ${site.siteId}: ${site.hours} (${site.timezone})`);
      });
    } else {
      console.log('✅ WORKING AS EXPECTED: No sites should execute on Friday');
      console.log('   📋 All sites are properly configured to be closed on Friday');
    }
    
    // Show detailed site information
    if (sitesWithoutBusinessHours.length > 0) {
      console.log('\n⚠️  SITES WITHOUT BUSINESS HOURS:');
      sitesWithoutBusinessHours.forEach(site => {
        console.log(`   • Site ${site.siteId}: ${site.reason}`);
        if (site.data) {
          console.log(`     Data: ${JSON.stringify(site.data, null, 2)}`);
        }
      });
    }
    
    if (fridayClosedSites.length > 0) {
      console.log('\n📅 SITES CLOSED ON FRIDAY:');
      fridayClosedSites.forEach(site => {
        console.log(`   • Site ${site.siteId}: ${site.reason}`);
        if (site.config) {
          console.log(`     Config: ${JSON.stringify(site.config, null, 2)}`);
        }
      });
    }
    
  } catch (error) {
    console.error('❌ Error during diagnosis:', error);
    console.log('\n🔍 DIAGNOSIS: Error occurred during evaluation');
    console.log('   📋 Impact: This would trigger fallback logic that executes on ALL weekdays');
    console.log('   🔧 Solution: Fix the underlying error shown above');
  }
}

// Run the diagnosis
diagnoseFridayExecution().catch(console.error); 