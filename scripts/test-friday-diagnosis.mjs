#!/usr/bin/env node

/**
 * Test Friday Diagnosis
 * This script simulates running the prioritization engine on Friday (day 5)
 * to see exactly what decision would be made
 */

import { config } from 'dotenv';
import { getSupabaseService } from '../dist/temporal/services/supabaseService.js';

// Load environment variables from .env.local
config({ path: '.env.local' });

async function testFridayDiagnosis() {
  console.log('🧪 TESTING FRIDAY PRIORITIZATION ENGINE LOGIC');
  console.log('==============================================');
  
  try {
    const supabaseService = getSupabaseService();
    
    // Get all sites and settings
    const sites = await supabaseService.fetchSites();
    const siteIds = sites.map(site => site.id);
    const settings = await supabaseService.fetchCompleteSettings(siteIds);
    
    console.log(`📊 Found ${sites.length} sites and ${settings.length} settings`);
    
    // Filter sites that have business_hours configured
    const sitesWithBusinessHours = settings.filter(setting => {
      const businessHours = setting.business_hours;
      
      if (!businessHours) return false;
      
      // New structure: business_hours is an array of schedule objects
      if (Array.isArray(businessHours) && businessHours.length > 0) {
        const firstSchedule = businessHours[0];
        return firstSchedule && 
               firstSchedule.days && 
               typeof firstSchedule.days === 'object' &&
               Object.keys(firstSchedule.days).length > 0;
      }
      
      // Old structure: business_hours is a direct object with day keys
      if (typeof businessHours === 'object' && !Array.isArray(businessHours)) {
        return Object.keys(businessHours).length > 0;
      }
      
      return false;
    });
    
    console.log(`📈 Sites with business_hours: ${sitesWithBusinessHours.length}`);
    
    // Check Friday configuration specifically
    console.log('\n🔍 DETAILED FRIDAY ANALYSIS:');
    
    const fridayOpenSites = [];
    const fridayClosedSites = [];
    
    for (const setting of sitesWithBusinessHours) {
      const businessHours = setting.business_hours;
      const siteId = setting.site_id;
      
      console.log(`\n📋 Site ${siteId}:`);
      console.log(`   Raw business_hours:`, JSON.stringify(businessHours, null, 2));
      
      // Handle both old and new business_hours structures
      let fridayConfig;
      
      if (Array.isArray(businessHours) && businessHours.length > 0) {
        // New structure: business_hours is an array of schedule objects
        const firstSchedule = businessHours[0];
        if (firstSchedule && firstSchedule.days && firstSchedule.days.friday) {
          const dayConfig = firstSchedule.days.friday;
          fridayConfig = {
            open: dayConfig.start,    // ← Converting start to open
            close: dayConfig.end,     // ← Converting end to close  
            enabled: dayConfig.enabled,
            timezone: firstSchedule.timezone,
            name: firstSchedule.name
          };
          console.log(`   ✅ Found new format Friday config:`, fridayConfig);
        } else {
          console.log(`   ❌ No Friday configuration found in new format`);
        }
      } else if (businessHours && typeof businessHours === 'object' && businessHours.friday) {
        // Old structure: business_hours is a direct object
        fridayConfig = businessHours.friday;
        console.log(`   ✅ Found old format Friday config:`, fridayConfig);
      } else {
        console.log(`   ❌ No Friday configuration found`);
      }
      
      if (!fridayConfig) {
        fridayClosedSites.push({
          siteId: setting.site_id,
          reason: 'No Friday configuration'
        });
        console.log(`   ❌ RESULT: No Friday configuration - CLOSED`);
        continue;
      }
      
      // Check if the site is open on Friday using CORRECTED logic
      const isOpenCheck1 = fridayConfig.enabled !== false;
      const isOpenCheck2 = !!fridayConfig.open;
      const isOpenCheck3 = !!fridayConfig.close;
      const isOpenCheck4 = fridayConfig.open !== fridayConfig.close;
      
      const isOpen = isOpenCheck1 && isOpenCheck2 && isOpenCheck3 && isOpenCheck4;
      
      console.log(`   🔍 Open checks:`);
      console.log(`      - enabled !== false: ${isOpenCheck1}`);
      console.log(`      - has open: ${isOpenCheck2}`);
      console.log(`      - has close: ${isOpenCheck3}`);
      console.log(`      - open !== close: ${isOpenCheck4}`);
      console.log(`      - FINAL RESULT: ${isOpen}`);
      
      if (isOpen) {
        fridayOpenSites.push({
          siteId: setting.site_id,
          hours: `${fridayConfig.open} - ${fridayConfig.close}`,
          enabled: fridayConfig.enabled,
          timezone: fridayConfig.timezone || 'Unknown'
        });
        console.log(`   ✅ RESULT: OPEN on Friday (${fridayConfig.open} - ${fridayConfig.close})`);
      } else {
        fridayClosedSites.push({
          siteId: setting.site_id,
          reason: fridayConfig.enabled === false ? 'Disabled' : 'Invalid hours',
          config: fridayConfig
        });
        console.log(`   ❌ RESULT: CLOSED on Friday - ${fridayConfig.enabled === false ? 'Disabled' : 'Invalid hours'}`);
      }
    }
    
    console.log(`\n📊 FRIDAY SUMMARY:`);
    console.log(`   - Total sites with business_hours: ${sitesWithBusinessHours.length}`);
    console.log(`   - Sites open on Friday: ${fridayOpenSites.length}`);
    console.log(`   - Sites closed on Friday: ${fridayClosedSites.length}`);
    
    // Simulate the prioritization engine decision
    console.log(`\n🎯 PRIORITIZATION ENGINE SIMULATION (Friday = Day 5):`);
    
    const totalSitesWithBusinessHours = sitesWithBusinessHours.length;
    const sitesOpenOnFriday = fridayOpenSites.length;
    
    let shouldExecuteOperations = false;
    let reason = '';
    
    if (totalSitesWithBusinessHours === 0) {
      // No sites have business_hours, use fallback logic
      shouldExecuteOperations = false; // NEW: Conservative fallback - excludes Friday
      reason = 'Weekend or Friday (conservative fallback mode)';
      console.log(`   🔄 FALLBACK LOGIC: No sites have business_hours`);
    } else if (sitesOpenOnFriday > 0) {
      shouldExecuteOperations = true;
      reason = `${sitesOpenOnFriday} site(s) have business hours on Friday`;
      console.log(`   ✅ EXECUTE LOGIC: Some sites are open on Friday`);
    } else {
      shouldExecuteOperations = false;
      reason = 'Sites with business_hours are closed on Friday';
      console.log(`   ❌ SKIP LOGIC: All sites with business_hours are closed on Friday`);
    }
    
    console.log(`\n🚨 FINAL DECISION: ${shouldExecuteOperations ? '✅ EXECUTE' : '❌ SKIP'}`);
    console.log(`🚨 REASON: ${reason}`);
    
    if (shouldExecuteOperations && sitesOpenOnFriday > 0) {
      console.log(`\n🏢 SITES THAT WOULD EXECUTE ON FRIDAY:`);
      fridayOpenSites.forEach(site => {
        console.log(`   • Site ${site.siteId}: ${site.hours} (${site.timezone})`);
      });
    }
    
    // Show why sites were marked as closed
    if (fridayClosedSites.length > 0) {
      console.log(`\n⏸️  SITES MARKED AS CLOSED ON FRIDAY:`);
      fridayClosedSites.forEach(site => {
        console.log(`   • Site ${site.siteId}: ${site.reason}`);
        if (site.config) {
          console.log(`     Config: ${JSON.stringify(site.config, null, 2)}`);
        }
      });
    }
    
  } catch (error) {
    console.error('❌ Error during Friday diagnosis test:', error);
  }
}

// Run the test
testFridayDiagnosis().catch(console.error); 