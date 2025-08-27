/**
 * Test for Email Sync Scheduling Service
 * Verifies that the scheduling logic correctly handles different cron statuses
 */

import { EmailSyncSchedulingService } from '../src/temporal/services/emailSyncSchedulingService';
import { Site, CronStatus } from '../src/temporal/services/mockDataService';

describe('EmailSyncSchedulingService', () => {
  const mockSite: Site = {
    id: 'test-site-id',
    name: 'Test Site',
    url: 'https://test.com',
    user_id: 'test-user-id',
    created_at: '2025-01-01T00:00:00.000Z',
    updated_at: '2025-01-01T00:00:00.000Z',
    email: {
      email: 'test@test.com',
      enabled: true,
      password: 'PASSWORD_PRESENT',
      incomingServer: 'imap.gmail.com',
      outgoingServer: 'smtp.gmail.com',
      incomingPort: '993',
      outgoingPort: '587',
      status: 'synced'
    }
  };

  describe('determineSiteScheduling', () => {
    it('should schedule sites with RUNNING status (scheduler handles timing)', () => {
      const mockCronStatus: CronStatus = {
        id: 'test-cron-id',
        workflow_id: 'test-workflow-id',
        schedule_id: 'test-schedule-id',
        activity_name: 'syncEmailsWorkflow',
        status: 'RUNNING',
        last_run: null,
        next_run: '2025-08-06T08:01:04.175+00:00',
        error_message: null,
        retry_count: 0,
        site_id: 'test-site-id',
        created_at: '2025-05-29T00:33:32.669+00:00',
        updated_at: '2025-08-06T07:01:04.278251+00:00'
      };

      const result = EmailSyncSchedulingService.determineSiteScheduling(
        mockSite,
        mockCronStatus,
        { minHoursBetweenSyncs: 1 }
      );

      expect(result.shouldSchedule).toBe(true);
      expect(result.hasValidEmailConfig).toBe(true);
      expect(result.reason).toContain('scheduler will handle timing');
    });

    it('should schedule sites with COMPLETED status regardless of timing', () => {
      const mockCronStatus: CronStatus = {
        id: 'test-cron-id',
        workflow_id: 'test-workflow-id',
        schedule_id: 'test-schedule-id',
        activity_name: 'syncEmailsWorkflow',
        status: 'COMPLETED',
        last_run: new Date(Date.now() - 30 * 60 * 1000).toISOString(), // 30 minutes ago
        next_run: '2025-08-27T18:00:33.64+00:00',
        error_message: null,
        retry_count: 0,
        site_id: 'test-site-id',
        created_at: '2025-08-15T22:00:25.1+00:00',
        updated_at: '2025-08-27T17:04:10.402525+00:00'
      };

      const result = EmailSyncSchedulingService.determineSiteScheduling(
        mockSite,
        mockCronStatus,
        { minHoursBetweenSyncs: 1 }
      );

      expect(result.shouldSchedule).toBe(true);
      expect(result.hasValidEmailConfig).toBe(true);
      expect(result.reason).toContain('scheduler will handle timing');
    });

    it('should not schedule sites with invalid email config', () => {
      const siteWithInvalidEmail: Site = {
        ...mockSite,
        email: {
          email: 'invalid-email', // Invalid email format
          enabled: true,
          password: 'PASSWORD_PRESENT',
          incomingServer: 'imap.gmail.com',
          outgoingServer: 'smtp.gmail.com',
          incomingPort: '993',
          outgoingPort: '587',
          status: 'synced'
        }
      };

      const result = EmailSyncSchedulingService.determineSiteScheduling(
        siteWithInvalidEmail,
        undefined,
        { minHoursBetweenSyncs: 1 }
      );

      expect(result.shouldSchedule).toBe(false);
      expect(result.hasValidEmailConfig).toBe(false);
      expect(result.reason).toContain('Email config invalid');
    });

    it('should schedule sites with no previous sync', () => {
      const result = EmailSyncSchedulingService.determineSiteScheduling(
        mockSite,
        undefined, // No previous sync
        { minHoursBetweenSyncs: 1 }
      );

      expect(result.shouldSchedule).toBe(true);
      expect(result.hasValidEmailConfig).toBe(true);
      expect(result.reason).toContain('No previous email sync found');
    });

    it('should schedule stuck RUNNING workflows after 2 hours', () => {
      const mockCronStatus: CronStatus = {
        id: 'test-cron-id',
        workflow_id: 'test-workflow-id',
        schedule_id: 'test-schedule-id',
        activity_name: 'syncEmailsWorkflow',
        status: 'RUNNING',
        last_run: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(), // 3 hours ago
        next_run: '2025-08-06T08:01:04.175+00:00',
        error_message: null,
        retry_count: 0,
        site_id: 'test-site-id',
        created_at: '2025-05-29T00:33:32.669+00:00',
        updated_at: '2025-08-06T07:01:04.278251+00:00'
      };

      const result = EmailSyncSchedulingService.determineSiteScheduling(
        mockSite,
        mockCronStatus,
        { minHoursBetweenSyncs: 1 }
      );

      expect(result.shouldSchedule).toBe(true);
      expect(result.hasValidEmailConfig).toBe(true);
      expect(result.reason).toContain('likely stuck, rescheduling');
    });
  });

  describe('processSitesForScheduling', () => {
    it('should process multiple sites correctly', () => {
      const sites: Site[] = [mockSite];
      const cronStatuses: CronStatus[] = [{
        id: 'test-cron-id',
        workflow_id: 'test-workflow-id',
        schedule_id: 'test-schedule-id',
        activity_name: 'syncEmailsWorkflow',
        status: 'RUNNING',
        last_run: null,
        next_run: '2025-08-06T08:01:04.175+00:00',
        error_message: null,
        retry_count: 0,
        site_id: 'test-site-id',
        created_at: '2025-05-29T00:33:32.669+00:00',
        updated_at: '2025-08-06T07:01:04.278251+00:00'
      }];

      const result = EmailSyncSchedulingService.processSitesForScheduling(
        sites,
        cronStatuses,
        { minHoursBetweenSyncs: 1 }
      );

      expect(result).toHaveLength(1);
      expect(result[0].shouldSchedule).toBe(true);
      expect(result[0].hasValidEmailConfig).toBe(true);
    });
  });
});
