import { getSupabaseService } from '../services/supabaseService';

// Prioritization Engine Activities

/**
 * Evaluates if any sites have business_hours that allow operations for the given day
 */
export async function evaluateBusinessHoursForDay(dayOfWeek: number): Promise<{
  shouldExecuteOperations: boolean;
  reason: string;
  sitesWithBusinessHours: number;
  sitesOpenToday: number;
  openSites: any[];
}> {
  console.log(`🕐 Evaluating business hours for day ${dayOfWeek} (0=Sunday, 6=Saturday)...`);
  
  try {
    const supabaseService = getSupabaseService();
    const isConnected = await supabaseService.getConnectionStatus();
    
    if (!isConnected) {
      console.log('⚠️  Database not connected, falling back to weekday-only logic');
      const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;
      return {
        shouldExecuteOperations: isWeekday,
        reason: isWeekday ? 'Weekday (fallback mode)' : 'Weekend (fallback mode)',
        sitesWithBusinessHours: 0,
        sitesOpenToday: 0,
        openSites: []
      };
    }

    // Get all sites
    const sites = await supabaseService.fetchSites();
    console.log(`📊 Found ${sites.length} total sites`);

    if (sites.length === 0) {
      return {
        shouldExecuteOperations: false,
        reason: 'No sites found in database',
        sitesWithBusinessHours: 0,
        sitesOpenToday: 0,
        openSites: []
      };
    }

    // Get complete settings including business_hours
    const siteIds = sites.map(site => site.id);
    const settings = await supabaseService.fetchCompleteSettings(siteIds);
    console.log(`⚙️  Retrieved settings for ${settings.length} sites`);

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
    console.log(`📉 Sites without business_hours (fallback): ${settings.length - sitesWithBusinessHours.length}`);

    // Check which sites are open today
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const today = dayNames[dayOfWeek];
    
    const openSites = sitesWithBusinessHours.filter(setting => {
      const businessHours = setting.business_hours;
      
      // Handle both old and new business_hours structures
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
      
      if (!todayHours) return false;
      
      // Check if the site is open today
      const isOpen = todayHours.enabled !== false && 
                     todayHours.open && 
                     todayHours.close && 
                     todayHours.open !== todayHours.close;
      
      if (isOpen) {
        const timezone = todayHours.timezone ? ` (${todayHours.timezone})` : '';
        const name = todayHours.name ? ` - ${todayHours.name}` : '';
        console.log(`✅ Site ${setting.site_id}${name} is open on ${today}: ${todayHours.open} - ${todayHours.close}${timezone}`);
      } else if (todayHours.enabled === false) {
        console.log(`⏸️  Site ${setting.site_id} has ${today} disabled in business hours`);
      }
      
      return isOpen;
    });

    const shouldExecuteOperations = openSites.length > 0;
    let reason: string;

    if (shouldExecuteOperations) {
      reason = `${openSites.length} site(s) have business hours on ${today}`;
    } else if (sitesWithBusinessHours.length > 0) {
      reason = `Sites with business_hours are closed on ${today}`;
    } else {
      // No sites have business_hours, use fallback logic
      const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;
      return {
        shouldExecuteOperations: isWeekday,
        reason: isWeekday ? 'Weekday (fallback for sites without business_hours)' : 'Weekend (no business_hours sites open)',
        sitesWithBusinessHours: 0,
        sitesOpenToday: 0,
        openSites: []
      };
    }

    console.log(`🎯 Decision: ${shouldExecuteOperations ? 'EXECUTE' : 'SKIP'} - ${reason}`);

    return {
      shouldExecuteOperations,
      reason,
      sitesWithBusinessHours: sitesWithBusinessHours.length,
      sitesOpenToday: openSites.length,
      openSites: openSites.map(site => {
        const businessHours = site.business_hours;
        let todayHours;
        
        if (Array.isArray(businessHours) && businessHours.length > 0) {
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
          todayHours = businessHours[today];
        }
        
        return {
          siteId: site.site_id,
          businessHours: todayHours
        };
      })
    };

  } catch (error) {
    console.error('❌ Error evaluating business hours:', error);
    
    // Fallback to simple weekday logic on error
    const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;
    return {
      shouldExecuteOperations: isWeekday,
      reason: `Error checking business_hours, fallback to ${isWeekday ? 'weekday' : 'weekend'} logic: ${error instanceof Error ? error.message : String(error)}`,
      sitesWithBusinessHours: 0,
      sitesOpenToday: 0,
      openSites: []
    };
  }
}

export async function getContext(): Promise<{ context: string; timestamp: Date }> {
  console.log('🔍 Getting context for prioritization...');
  
  // Simulate getting context from various sources
  // This could include user data, project status, deadlines, etc.
  const context = {
    projects: ['Project A', 'Project B', 'Project C'],
    deadlines: ['2024-01-15', '2024-01-20', '2024-01-25'],
    resources: ['Team 1', 'Team 2', 'Team 3'],
    priorities: ['High', 'Medium', 'Low']
  };
  
  console.log('✅ Context retrieved successfully');
  return {
    context: JSON.stringify(context),
    timestamp: new Date()
  };
}

export async function designPlan(context: string): Promise<{ plan: string; activities: string[] }> {
  console.log('📋 Designing prioritization plan...');
  
  // Parse context for future use
  JSON.parse(context);
  
  // Simulate AI/algorithm-based plan design
  const plan = {
    strategy: 'Priority-based resource allocation',
    timeline: '24 hours',
    methodology: 'Weighted scoring with deadline consideration'
  };
  
  const activities = [
    'Review project deadlines',
    'Assess resource availability', 
    'Calculate priority scores',
    'Allocate resources',
    'Schedule tasks'
  ];
  
  console.log('✅ Plan designed successfully');
  return {
    plan: JSON.stringify(plan),
    activities
  };
}

export async function sendPlan(_plan: string): Promise<{ sent: boolean; recipients: string[] }> {
  console.log('📤 Sending prioritization plan...');
  
  // Simulate sending plan to stakeholders
  const recipients = [
    'project-manager@company.com',
    'team-lead@company.com',
    'stakeholder@company.com'
  ];
  
  // Here you would integrate with email service, Slack, etc.
  console.log('📧 Plan sent to:', recipients.join(', '));
  
  console.log('✅ Plan sent successfully');
  return {
    sent: true,
    recipients
  };
}

export async function sendPriorityMail(activities: string[]): Promise<{ sent: boolean; count: number }> {
  console.log('📬 Sending priority notifications...');
  
  // Simulate sending priority emails for each activity
  for (const activity of activities) {
    console.log(`📧 Sending priority notification for: ${activity}`);
    // Simulate email sending delay
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  console.log('✅ All priority notifications sent');
  return {
    sent: true,
    count: activities.length
  };
}

export async function scheduleActivities(activities: string[]): Promise<{ scheduled: boolean; apiCalls: number }> {
  console.log('📅 Scheduling activities via API calls...');
  
  let apiCallCount = 0;
  
  for (const activity of activities) {
    console.log(`🔗 Making API call to schedule: ${activity}`);
    
    // Simulate different API calls for scheduling
    try {
      // This could be calls to project management tools, calendar APIs, etc.
      await simulateApiCall(activity);
      apiCallCount++;
    } catch (error) {
      console.error(`❌ Failed to schedule ${activity}:`, error);
    }
  }
  
  console.log('✅ All activities scheduled via API');
  return {
    scheduled: true,
    apiCalls: apiCallCount
  };
}

// Helper function to simulate API calls
async function simulateApiCall(activity: string): Promise<void> {
  // Simulate API call delay and potential failure
  await new Promise(resolve => setTimeout(resolve, 200));
  
  // Simulate 5% failure rate
  if (Math.random() < 0.05) {
    throw new Error(`API call failed for ${activity}`);
  }
  
  console.log(`✅ API call successful for: ${activity}`);
} 