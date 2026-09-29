/**
 * Tests for workflow activities settings logic
 */

import { shouldScheduleWorkflow } from '../src/temporal/utils/activityOptIn';

describe('shouldScheduleWorkflow logic', () => {

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
      expect(shouldScheduleWorkflow(site, 'leads_follow_up')).toBe(false);

      // Mining stays enabled; outreach remains opt-in.
      expect(shouldScheduleWorkflow(site, 'icp_lead_generation')).toBe(true);
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
      expect(shouldScheduleWorkflow(site, 'icp_lead_generation')).toBe(true);
    });

    it('keeps daily summaries and independent mining while outreach is disabled', () => {
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
      expect(shouldScheduleWorkflow(site, 'icp_lead_generation')).toBe(true);
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