/**
 * Test script to verify business hours parsing logic
 * Tests the real structure from the database
 */
async function testBusinessHoursParsing() {
  console.log('🧪 Testing Business Hours Parsing Logic...\n');
  
  // Simulate the parsing logic directly
  const mockBusinessHoursData = [
    {
      "days": {
        "friday": {
          "end": "18:00",
          "start": "09:00",
          "enabled": true
        },
        "monday": {
          "end": "18:00",
          "start": "09:00",
          "enabled": true
        },
        "sunday": {
          "end": "14:00",
          "start": "11:00",
          "enabled": true
        },
        "tuesday": {
          "end": "18:00",
          "start": "09:00",
          "enabled": true
        },
        "saturday": {
          "end": "14:00",
          "start": "09:00",
          "enabled": true
        },
        "thursday": {
          "end": "18:00",
          "start": "09:00",
          "enabled": true
        },
        "wednesday": {
          "end": "18:00",
          "start": "09:00",
          "enabled": true
        }
      },
      "name": "Bajío Offices @ Sinergia",
      "timezone": "America/Mexico_City",
      "respectHolidays": true
    }
  ];

  function testBusinessHoursParsingLogic(dayOfWeek: number, businessHours: any) {
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const today = dayNames[dayOfWeek];
    
    let todayHours;
    
    if (Array.isArray(businessHours) && businessHours.length > 0) {
      // New structure: business_hours is an array of schedule objects
      const firstSchedule = businessHours[0];
      if (firstSchedule && firstSchedule.days && firstSchedule.days[today]) {
        const dayConfig = firstSchedule.days[today];
        todayHours = {
          open: dayConfig.start,
          close: dayConfig.end,
          enabled: dayConfig.enabled,
          timezone: firstSchedule.timezone,
          name: firstSchedule.name
        };
      }
    } else if (businessHours && typeof businessHours === 'object' && businessHours[today]) {
      // Old structure: business_hours is a direct object
      todayHours = businessHours[today];
    }
    
    if (!todayHours) return null;
    
    // Check if the site is open today
    const isOpen = todayHours.enabled !== false && 
                   todayHours.open && 
                   todayHours.close && 
                   todayHours.open !== todayHours.close;
    
    return isOpen ? todayHours : null;
  }

  // Test all days of the week
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  
  for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek++) {
    console.log(`\n📅 Testing ${days[dayOfWeek]} (${dayOfWeek}):`);
    console.log('=' .repeat(50));
    
    try {
      const result = testBusinessHoursParsingLogic(dayOfWeek, mockBusinessHoursData);
      
      if (result) {
        console.log(`✅ Site is OPEN:`);
        console.log(`   Hours: ${result.open} - ${result.close}`);
        console.log(`   Name: ${result.name}`);
        console.log(`   Timezone: ${result.timezone}`);
        console.log(`   Should execute operations: YES`);
      } else {
        console.log(`⏭️ Site is CLOSED`);
        console.log(`   Should execute operations: NO (would fall back to weekday logic)`);
      }
      
    } catch (error) {
      console.error(`❌ Error testing ${days[dayOfWeek]}:`, error);
    }
  }
  
  console.log('\n🎉 Business Hours Parsing Test Complete!');
  console.log('Expected results:');
  console.log('  - Monday-Friday: Should execute (09:00-18:00)');
  console.log('  - Saturday: Should execute (09:00-14:00)');
  console.log('  - Sunday: Should execute (11:00-14:00)');
  console.log('  - All days should show "Bajío Offices @ Sinergia" as open');
}

// Run the test
testBusinessHoursParsing().catch(console.error); 