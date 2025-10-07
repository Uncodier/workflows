/**
 * Tests for workflow activities settings logic
 */

describe('shouldScheduleWorkflow logic', () => {
  // Replicate the helper function for testing
  function shouldScheduleWorkflow(site: any, activityKey: string): boolean {
    // If settings.activities doesn't exist, schedule as always (backward compatibility)
    if (!site.settings || !site.settings.activities) {
      return true;
    }

    const activityConfig = site.settings.activities[activityKey];
    
    // If the activity doesn't exist in settings.activities, schedule by default
    if (!activityConfig) {
      return true;
    }

    // If the activity status is 'inactive', do NOT schedule
    if (activityConfig.status === 'inactive') {
      return false;
    }

    // Otherwise (status is 'default' or any other value), schedule normally
    return true;
  }

  describe('Backward compatibility', () => {
    it('should schedule when site has no settings', () => {
      const site = { id: '1', name: 'Test Site' };
      expect(shouldScheduleWorkflow(site, 'daily_resume_and_stand_up')).toBe(true);
    });

    it('should schedule when site has settings but no activities', () => {
      const site = { 
        id: '1', 
        name: 'Test Site',
        settings: { some_other_setting: true }
      };
      expect(shouldScheduleWorkflow(site, 'daily_resume_and_stand_up')).toBe(true);
    });

    it('should schedule when activity key does not exist in activities', () => {
      const site = { 
        id: '1', 
        name: 'Test Site',
        settings: { 
          activities: {
            icp_lead_generation: { status: 'default' }
          }
        }
      };
      expect(shouldScheduleWorkflow(site, 'daily_resume_and_stand_up')).toBe(true);
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

    it('should schedule when status is default', () => {
      const site = { 
        id: '1', 
        name: 'Test Site',
        settings: { 
          activities: {
            daily_resume_and_stand_up: { status: 'default' }
          }
        }
      };
      expect(shouldScheduleWorkflow(site, 'daily_resume_and_stand_up')).toBe(true);
    });

    it('should schedule when status is any value other than inactive', () => {
      const site = { 
        id: '1', 
        name: 'Test Site',
        settings: { 
          activities: {
            daily_resume_and_stand_up: { status: 'custom' }
          }
        }
      };
      expect(shouldScheduleWorkflow(site, 'daily_resume_and_stand_up')).toBe(true);
    });
  });

  describe('Multiple activities', () => {
    it('should handle mixed statuses correctly', () => {
      const site = { 
        id: '1', 
        name: 'Test Site',
        settings: { 
          activities: {
            daily_resume_and_stand_up: { status: 'default' },
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
      
      // But should still allow other workflows
      expect(shouldScheduleWorkflow(site, 'daily_resume_and_stand_up')).toBe(true);
      expect(shouldScheduleWorkflow(site, 'icp_lead_generation')).toBe(true);
    });

    it('should keep only daily summaries', () => {
      const site = { 
        id: '1', 
        name: 'Test Site',
        settings: { 
          activities: {
            daily_resume_and_stand_up: { status: 'default' },
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
      expect(shouldScheduleWorkflow(site, 'daily_resume_and_stand_up')).toBe(true);
    });

    it('should handle undefined settings', () => {
      const site = { 
        id: '1', 
        name: 'Test Site',
        settings: undefined
      };
      expect(shouldScheduleWorkflow(site, 'daily_resume_and_stand_up')).toBe(true);
    });

    it('should handle null activities', () => {
      const site = { 
        id: '1', 
        name: 'Test Site',
        settings: {
          activities: null
        }
      };
      expect(shouldScheduleWorkflow(site, 'daily_resume_and_stand_up')).toBe(true);
    });

    it('should handle empty activities object', () => {
      const site = { 
        id: '1', 
        name: 'Test Site',
        settings: {
          activities: {}
        }
      };
      expect(shouldScheduleWorkflow(site, 'daily_resume_and_stand_up')).toBe(true);
    });
  });
});

