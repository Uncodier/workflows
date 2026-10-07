import type { SiteSetupResult as LegacyResult } from '../siteSetupLegacyWorkflow';

export type SetupStepName = 'agents' | 'segments' | 'account_manager' | 'follow_up_email';
export type SetupStepState = 'completed' | 'partial' | 'skipped' | 'failed';
export interface SetupStepOutcome {
  status: SetupStepState;
  reason?: string;
}

export interface SiteSetupResult extends LegacyResult {
  status?: 'completed' | 'partial' | 'failed';
  steps?: Record<SetupStepName, SetupStepOutcome>;
  agents_existing?: number;
}

export function createSetupResult(siteId: string): SiteSetupResult {
  return {
    success: false,
    site_id: siteId,
    agents_created: { success: false, total_created: 0, agents: [] },
    segments_created: { success: false, segments_built: 0 },
    account_manager_assigned: {
      success: false, account_manager: { manager_id: '', name: '', email: '' }, assignment_date: '',
    },
    follow_up_email_sent: { success: false, messageId: '', recipient: '', timestamp: '' },
    setup_completed_at: new Date().toISOString(),
    steps: {
      agents: { status: 'skipped', reason: 'not_started' },
      segments: { status: 'skipped', reason: 'not_started' },
      account_manager: { status: 'skipped', reason: 'not_started' },
      follow_up_email: { status: 'skipped', reason: 'not_started' },
    },
  };
}

export function finishSetupResult(result: SiteSetupResult): SiteSetupResult {
  const steps = Object.values(result.steps ?? {});
  const failed = steps.some(step => step.status === 'failed' || step.status === 'partial');
  const usable = steps.some(step => step.status === 'completed' || step.status === 'partial');
  const missing = steps.some(step => step.status === 'skipped' && step.reason !== 'disabled');
  result.status = !usable && !result.agents_created.success ? 'failed'
    : failed || missing ? 'partial' : 'completed';
  result.success = !failed && result.agents_created.success;
  result.setup_completed_at = new Date().toISOString();
  return result;
}