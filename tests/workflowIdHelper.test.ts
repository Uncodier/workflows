import { generateDailyWorkflowId, DAILY_WORKFLOW_REUSE_POLICY } from '../src/temporal/utils/workflowIdHelper';
import { WorkflowIdReusePolicy } from '@temporalio/common';

describe('workflowIdHelper', () => {
  describe('generateDailyWorkflowId', () => {
    it('generates a deterministic ID without a timer infix if isTimer is false', () => {
      const id1 = generateDailyWorkflowId({
        workflowType: 'daily-standup',
        siteId: 'site123',
        dateStr: '2026-08-31',
        isTimer: false
      });
      expect(id1).toBe('daily-standup-site123-2026-08-31');
    });

    it('generates a deterministic ID with a timer infix if isTimer is true', () => {
      const id1 = generateDailyWorkflowId({
        workflowType: 'daily-standup',
        siteId: 'site123',
        dateStr: '2026-08-31',
        isTimer: true
      });
      expect(id1).toBe('daily-standup-timer-site123-2026-08-31');
    });

    it('includes the time string when provided, replacing colons', () => {
      const id1 = generateDailyWorkflowId({
        workflowType: 'daily-standup',
        siteId: 'site123',
        dateStr: '2026-08-31',
        timeStr: '09:00',
        isTimer: true
      });
      expect(id1).toBe('daily-standup-timer-site123-2026-08-31-0900');
    });

    it('produces the same ID for the same inputs', () => {
      const options = {
        workflowType: 'lead-generation',
        siteId: 'site-abc-123',
        dateStr: '2026-09-01',
        timeStr: '10:30',
        isTimer: true
      };
      
      const id1 = generateDailyWorkflowId(options);
      const id2 = generateDailyWorkflowId(options);
      
      expect(id1).toBe(id2);
      expect(id1).toBe('lead-generation-timer-site-abc-123-2026-09-01-1030');
    });

    it('produces different IDs for different dates or times', () => {
      const id1 = generateDailyWorkflowId({
        workflowType: 'test',
        siteId: 'site1',
        dateStr: '2026-08-31',
        timeStr: '09:00',
        isTimer: true
      });
      
      const id2 = generateDailyWorkflowId({
        workflowType: 'test',
        siteId: 'site1',
        dateStr: '2026-09-01',
        timeStr: '09:00',
        isTimer: true
      });
      
      const id3 = generateDailyWorkflowId({
        workflowType: 'test',
        siteId: 'site1',
        dateStr: '2026-08-31',
        timeStr: '10:00',
        isTimer: true
      });

      expect(id1).not.toBe(id2);
      expect(id1).not.toBe(id3);
      expect(id2).not.toBe(id3);
    });
  });

  describe('DAILY_WORKFLOW_REUSE_POLICY', () => {
    it('is set to WorkflowIdReusePolicy.ALLOW_DUPLICATE_FAILED_ONLY', () => {
      expect(DAILY_WORKFLOW_REUSE_POLICY).toBe(WorkflowIdReusePolicy.ALLOW_DUPLICATE_FAILED_ONLY);
    });
  });
});
