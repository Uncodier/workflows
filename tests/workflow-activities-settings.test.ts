/**
 * Tests for workflow activities settings logic
 */

describe('shouldScheduleWorkflow logic', () => {
  // Replicate the helper function for testing
  function shouldScheduleWorkflow(site: any, activityKey: string): boolean {
    // Define activities that are opt-in (require explicit 'active' status to run)
    const optInActivities = ['supervise_conversations', 'assign_leads_to_team', 'local_lead_generation', 'icp_lead_generation', 'daily_resume_and_stand_up'];
    const isOptIn = optInActivities.includes(activityKey);

    // If settings.activities doesn't exist, handle based on opt-in status
    if (!site.settings || !site.settings.activities) {
      return !isOptIn; // Schedule by default if not opt-in
    }

    const activityConfig = site.settings.activities[activityKey];
    
    // If the activity doesn't exist in settings.activities, handle based on opt-in status
    if (!activityConfig) {
      return !isOptIn; // Schedule by default if not opt-in
    }

    // If the activity status is explicitly 'active', schedule it
    if (activityConfig.status === 'active') {
      return true;
    }

    // If the activity status is 'inactive', do NOT schedule
    if (activityConfig.status === 'inactive') {
      return false;
    }

    // For 'default' or any other status:
    // Opt-in activities default to inactive, others default to active
    return !isOptIn;
  }

  describe('Backward compatibility', () => {
    it('should schedule non opt-in activities and NOT schedule opt-in activities when site has no settings', () => {
      const site = { id: '1', name: 'Test Site' };
      expect(shouldScheduleWorkflow(site, 'email_sync')).toBe(true);
      expect(shouldScheduleWorkflow(site, 'daily_resume_and_stand_up')).toBe(false);
    });

    it('should schedule non opt-in activities when site has settings but no activities', () => {
      const site = { 
        id: '1', 
        name: 'Test Site',
        settings: { some_other_setting: true }
      };
      expect(shouldScheduleWorkflow(site, 'email_sync')).toBe(true);
      expect(shouldScheduleWorkflow(site, 'daily_resume_and_stand_up')).toBe(false);
    });

    it('should use default behavior when activity key does not exist in activities', () => {
      const site = { 
        id: '1', 
        name: 'Test Site',
        settings: { 
          activities: {
            icp_lead_generation: { status: 'default' }
          }
        }
      };
      expect(shouldScheduleWorkflow(site, 'email_sync')).toBe(true);
      expect(shouldScheduleWorkflow(site, 'daily_resume_and_stand_up')).toBe(false);
    });
  });

  describe('Active control', () => {
    it('should NOT schedule when status is inactive', () => {
      const site = { 
        id: '1', 
        name: 'Test Site',
        settings: { 
          activities: {
            daily_resume_and_stand_up: { status: 'inactive' }
          }
        }
      };
      expect(shouldScheduleWorkflow(site, 'daily_resume_and_stand_up')).toBe(false);
    });

    it('should schedule opt-in activities when status is active', () => {
      const site = { 
        id: '1', 
        name: 'Test Site',
        settings: { 
          activities: {
            daily_resume_and_stand_up: { status: 'active' }
          }
        }
      };
      expect(shouldScheduleWorkflow(site, 'daily_resume_and_stand_up')).toBe(true);
    });

    it('should default opt-in activities to false when status is default', () => {
      const site = { 
        id: '1', 
        name: 'Test Site',
        settings: { 
          activities: {
            daily_resume_and_stand_up: { status: 'default' }
          }
        }
      };
      expect(shouldScheduleWorkflow(site, 'daily_resume_and_stand_up')).toBe(false);
    });

    it('should fallback to isOptIn logic when status is any value other than inactive or active', () => {
      const site = { 
        id: '1', 
        name: 'Test Site',
        settings: { 
          activities: {
            daily_resume_and_stand_up: { status: 'custom' },
            email_sync: { status: 'custom' }
          }
        }
      };
      expect(shouldScheduleWorkflow(site, 'daily_resume_and_stand_up')).toBe(false); // optIn -> false
      expect(shouldScheduleWorkflow(site, 'email_sync')).toBe(true); // non optIn -> true
    });
  });

  describe('Multiple activities', () => {
    it('should handle mixed statuses correctly', () => {
      const site = { 
        id: '1', 
        name: 'Test Site',
        settings: { 
          activities: {
            daily_resume_and_stand_up: { status: 'active' },
            icp_lead_generation: { status: 'inactive' },
            leads_follow_up: { status: 'default' },
            leads_initial_cold_outreach: { status: 'inactive' }
          }
        }
      };

      // Should schedule these
      expect(shouldScheduleWorkflow(site, 'daily_resume_and_stand_up')).toBe(true);
      expect(shouldScheduleWorkflow(site, 'leads_follow_up')).toBe(true);

      // Should NOT schedule these
      expect(shouldScheduleWorkflow(site, 'icp_lead_generation')).toBe(false);
      expect(shouldScheduleWorkflow(site, 'leads_initial_cold_outreach')).toBe(false);

      // Should schedule activities not in the list (default behavior)
      expect(shouldScheduleWorkflow(site, 'email_sync')).toBe(true);
    });
  });

  describe('Real-world scenarios', () => {
    it('should disable all cold outreach', () => {
      const site = { 
        id: '1', 
        name: 'Test Site',
        settings: { 
          activities: {
            leads_initial_cold_outreach: { status: 'inactive' },
            leads_follow_up: { status: 'inactive' }
          }
        }
      };

      expect(shouldScheduleWorkflow(site, 'leads_initial_cold_outreach')).toBe(false);
      expect(shouldScheduleWorkflow(site, 'leads_follow_up')).toBe(false);
      
      // But should still allow other workflows based on defaults
      expect(shouldScheduleWorkflow(site, 'email_sync')).toBe(true);
      
      // Opt-in activities should be false since they aren't explicitly active
      expect(shouldScheduleWorkflow(site, 'daily_resume_and_stand_up')).toBe(false);
      expect(shouldScheduleWorkflow(site, 'icp_lead_generation')).toBe(false);
    });

    it('should keep only daily summaries when configured', () => {
      const site = { 
        id: '1', 
        name: 'Test Site',
        settings: { 
          activities: {
            daily_resume_and_stand_up: { status: 'active' },
            leads_follow_up: { status: 'inactive' },
            icp_lead_generation: { status: 'inactive' },
            leads_initial_cold_outreach: { status: 'inactive' }
          }
        }
      };

      expect(shouldScheduleWorkflow(site, 'daily_resume_and_stand_up')).toBe(true);
      expect(shouldScheduleWorkflow(site, 'leads_follow_up')).toBe(false);
      expect(shouldScheduleWorkflow(site, 'icp_lead_generation')).toBe(false);
      expect(shouldScheduleWorkflow(site, 'leads_initial_cold_outreach')).toBe(false);
    });
  });

  describe('Edge cases', () => {
    it('should handle null settings', () => {
      const site = { 
        id: '1', 
        name: 'Test Site',
        settings: null
      };
      expect(shouldScheduleWorkflow(site, 'daily_resume_and_stand_up')).toBe(false);
      expect(shouldScheduleWorkflow(site, 'email_sync')).toBe(true);
    });

    it('should handle undefined settings', () => {
      const site = { 
        id: '1', 
        name: 'Test Site',
        settings: undefined
      };
      expect(shouldScheduleWorkflow(site, 'daily_resume_and_stand_up')).toBe(false);
      expect(shouldScheduleWorkflow(site, 'email_sync')).toBe(true);
    });

    it('should handle null activities', () => {
      const site = { 
        id: '1', 
        name: 'Test Site',
        settings: {
          activities: null
        }
      };
      expect(shouldScheduleWorkflow(site, 'daily_resume_and_stand_up')).toBe(false);
      expect(shouldScheduleWorkflow(site, 'email_sync')).toBe(true);
    });

    it('should handle empty activities object', () => {
      const site = { 
        id: '1', 
        name: 'Test Site',
        settings: {
          activities: {}
        }
      };
      expect(shouldScheduleWorkflow(site, 'daily_resume_and_stand_up')).toBe(false);
      expect(shouldScheduleWorkflow(site, 'email_sync')).toBe(true);
    });
  });
});