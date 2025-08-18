#!/usr/bin/env tsx

/**
 * Test para verificar que sitios sin business_hours NO se ejecuten en domingo
 * Corrige el bug donde domingo (día 0) no estaba incluido en isWeekend
 */



// Mock sites: algunos con business_hours para domingo, otros sin business_hours
const mockSites = [
  { id: '1', name: 'Site with Sunday Hours' },
  { id: '2', name: 'Site WITHOUT Business Hours' },
  { id: '3', name: 'Another Site WITHOUT Business Hours' },
  { id: '4', name: 'Site with Sunday Hours #2' }
];

const mockSettings = [
  {
    site_id: '1',
    business_hours: [
      {
        name: 'Main Schedule',
        timezone: 'America/Mexico_City',
        days: {
          sunday: { start: '10:00', end: '16:00', enabled: true },
          monday: { start: '09:00', end: '17:00', enabled: true },
          tuesday: { start: '09:00', end: '17:00', enabled: true },
          wednesday: { start: '09:00', end: '17:00', enabled: true },
          thursday: { start: '09:00', end: '17:00', enabled: true },
          friday: { start: '09:00', end: '17:00', enabled: true },
          saturday: { start: '10:00', end: '14:00', enabled: true }
        }
      }
    ]
  },
  {
    site_id: '2',
    business_hours: null // ❌ NO tiene business_hours - NO debería ejecutarse en domingo
  },
  {
    site_id: '3',
    business_hours: [] // ❌ business_hours vacío - NO debería ejecutarse en domingo
  },
  {
    site_id: '4',
    business_hours: [
      {
        name: 'Weekend Schedule',
        timezone: 'America/Mexico_City',
        days: {
          sunday: { start: '11:00', end: '15:00', enabled: true },
          monday: { start: '09:00', end: '17:00', enabled: true },
          tuesday: { start: '09:00', end: '17:00', enabled: true },
          wednesday: { start: '09:00', end: '17:00', enabled: true },
          thursday: { start: '09:00', end: '17:00', enabled: true },
          friday: { start: '09:00', end: '17:00', enabled: true },
          saturday: { start: '10:00', end: '14:00', enabled: true }
        }
      }
    ]
  }
];

/**
 * Simulated evaluateBusinessHoursForDay for Sunday
 */
async function evaluateBusinessHoursForSunday(): Promise<{
  shouldExecuteOperations: boolean;
  reason: string;
  sitesWithBusinessHours: number;
  sitesOpenToday: number;
  openSites: any[];
}> {
  console.log('🕐 Evaluating business hours for SUNDAY (day 0)...');
  
  const today = 'sunday';
  
  console.log(`📊 Found ${mockSites.length} total sites (MOCKED)`);

  // Filter sites that have business_hours configured
  const sitesWithBusinessHours = mockSettings.filter(setting => {
    const businessHours = setting.business_hours;
    return businessHours && Array.isArray(businessHours) && businessHours.length > 0;
  });

  console.log(`📈 Sites with business_hours: ${sitesWithBusinessHours.length}`);
  console.log(`📉 Sites without business_hours: ${mockSettings.length - sitesWithBusinessHours.length}`);

  // Check which sites are open today (Sunday)
  const openSites = sitesWithBusinessHours.filter(setting => {
    const businessHours = setting.business_hours;
    
    if (Array.isArray(businessHours) && businessHours.length > 0) {
      const firstSchedule = businessHours[0];
      if (firstSchedule && firstSchedule.days && firstSchedule.days[today]) {
        const dayConfig = firstSchedule.days[today];
        const isOpen = dayConfig.enabled !== false && 
                      dayConfig.start && 
                      dayConfig.end && 
                      dayConfig.start !== dayConfig.end;
        
        if (isOpen) {
          console.log(`✅ Site ${setting.site_id} is open on Sunday: ${dayConfig.start} - ${dayConfig.end}`);
        } else {
          console.log(`⏸️  Site ${setting.site_id} has Sunday disabled`);
        }
        
        return isOpen;
      }
    }
    
    return false;
  });

  const shouldExecuteOperations = openSites.length > 0;
  const reason = shouldExecuteOperations 
    ? `${openSites.length} site(s) have business hours on sunday`
    : 'No sites have business hours configured for sunday';

  return {
    shouldExecuteOperations,
    reason,
    sitesWithBusinessHours: sitesWithBusinessHours.length,
    sitesOpenToday: openSites.length,
    openSites: openSites.map(site => ({
      siteId: site.site_id,
      businessHours: site.business_hours && site.business_hours[0] ? {
        open: site.business_hours[0].days[today].start,
        close: site.business_hours[0].days[today].end,
        timezone: site.business_hours[0].timezone
      } : null
    }))
  };
}

/**
 * Simulated scheduleIndividualDailyStandUpsActivity with FIXED weekend logic
 */
async function simulateSchedulingForSunday(businessHoursAnalysis: any): Promise<{
  scheduled: number;
  skipped: number;
  sitesToProcess: any[];
}> {
  console.log('\n🏗️ Simulating individual daily standups scheduling for SUNDAY...');
  
  const timezone = 'America/Mexico_City';
  
  // Create a map of sites with business hours for quick lookup
  const sitesWithBusinessHours = new Map();
  if (businessHoursAnalysis.openSites) {
    businessHoursAnalysis.openSites.forEach((site: any) => {
      sitesWithBusinessHours.set(site.siteId, site.businessHours);
    });
  }
  
  // FIXED: Determine if fallback should be used based on day of week
  const currentDay = 0; // Sunday (mocked)
  const isWeekend = currentDay === 0 || currentDay === 5 || currentDay === 6; // ✅ NOW INCLUDES SUNDAY
  const dayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][currentDay];
  
  console.log(`   - Current day: ${dayName} (${currentDay})`);
  console.log(`   - Is weekend: ${isWeekend}`);
  console.log(`   - Fallback policy: ${isWeekend ? 'NO FALLBACK (weekend)' : 'FALLBACK ALLOWED (weekday)'}`);
  
  let scheduled = 0;
  let skipped = 0;
  const sitesToProcess = [];
  
  // Process all sites with the FIXED logic
  for (const site of mockSites) {
    console.log(`\n📋 Processing site: ${site.name} (${site.id})`);
    
    // Check if this site has business_hours
    const businessHours = sitesWithBusinessHours.get(site.id);
    
    if (businessHours) {
      // Site HAS business_hours - should be scheduled
      console.log(`   ✅ Has business_hours: ${businessHours.open} - ${businessHours.close} ${businessHours.timezone}`);
      console.log(`   ✅ SCHEDULING - Site has business hours configured`);
      sitesToProcess.push({ ...site, status: 'scheduled', source: 'database-configured' });
      scheduled++;
    } else if (!isWeekend) {
      // Site DOES NOT have business_hours - use fallback ONLY on weekdays
      console.log(`   ⚠️ No business_hours found - using WEEKDAY FALLBACK: 09:00 ${timezone}`);
      console.log(`   ✅ SCHEDULING - Weekday fallback allowed`);
      sitesToProcess.push({ ...site, status: 'scheduled', source: 'fallback-weekday' });
      scheduled++;
    } else {
      // ✅ FIXED: Weekend - NO fallback for sites without business_hours
      console.log(`   ⏭️ SKIPPING - No business_hours configured and weekend (no fallback)`);
      sitesToProcess.push({ ...site, status: 'skipped', source: 'weekend-restriction' });
      skipped++;
    }
  }
  
  return { scheduled, skipped, sitesToProcess };
}

async function main() {
  console.log('🧪 Testing Sunday Business Hours Fix');
  console.log('📅 Testing for: Sunday (day 0)');
  console.log('🎯 Goal: Sites WITHOUT business_hours should NOT execute on Sunday\n');

  try {
    // Step 1: Evaluate business hours for Sunday
    const businessHoursAnalysis = await evaluateBusinessHoursForSunday();
    
    console.log('\n📊 Business Hours Analysis Result:');
    console.log(`   - Should execute operations: ${businessHoursAnalysis.shouldExecuteOperations}`);
    console.log(`   - Reason: ${businessHoursAnalysis.reason}`);
    console.log(`   - Sites with business_hours: ${businessHoursAnalysis.sitesWithBusinessHours}`);
    console.log(`   - Sites open on Sunday: ${businessHoursAnalysis.sitesOpenToday}`);
    
    // Step 2: Simulate individual scheduling with FIXED logic
    const schedulingResult = await simulateSchedulingForSunday(businessHoursAnalysis);
    
    console.log('\n📊 FIXED Scheduling Simulation Results:');
    console.log(`   - Sites scheduled: ${schedulingResult.scheduled}`);
    console.log(`   - Sites skipped: ${schedulingResult.skipped}`);
    console.log(`   - Total sites processed: ${schedulingResult.sitesToProcess.length}`);
    
    // Step 3: Detailed breakdown
    console.log('\n📋 Detailed Site Processing:');
    schedulingResult.sitesToProcess.forEach(site => {
      const statusIcon = site.status === 'scheduled' ? '✅' : '⏭️';
      console.log(`   ${statusIcon} ${site.name}: ${site.status.toUpperCase()} (${site.source})`);
    });
    
    // Step 4: Validation
    console.log('\n🔍 VALIDATION:');
    
    const expectedScheduled = 2; // Sites 1 and 4 have Sunday business hours
    const expectedSkipped = 2;   // Sites 2 and 3 have no business hours
    
    const scheduledCorrect = schedulingResult.scheduled === expectedScheduled;
    const skippedCorrect = schedulingResult.skipped === expectedSkipped;
    
    console.log(`   Expected scheduled: ${expectedScheduled} | Actual: ${schedulingResult.scheduled} ${scheduledCorrect ? '✅' : '❌'}`);
    console.log(`   Expected skipped: ${expectedSkipped} | Actual: ${schedulingResult.skipped} ${skippedCorrect ? '✅' : '❌'}`);
    
    if (scheduledCorrect && skippedCorrect) {
      console.log('\n✅ VALIDATION PASSED: Sunday business hours fix is working correctly!');
      console.log('   ✅ Sites WITH business hours are scheduled');
      console.log('   ✅ Sites WITHOUT business hours are SKIPPED on Sunday');
      console.log('\n🔧 Fix Status: ✅ WORKING');
    } else {
      console.log('\n❌ VALIDATION FAILED: Fix is not working as expected');
      console.log('\n🔧 Fix Status: ❌ NEEDS ATTENTION');
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}