import { isCancellation, proxyActivities, startChild } from '@temporalio/workflow';
import type { Activities } from '../../activities';
import type { SiteSetupParams } from '../../activities/siteSetupActivities';
import { defaultAgentsConfig, getAgentTypes } from '../../config/agentsConfig';
import { buildSegmentsWorkflow } from '../buildSegmentsWorkflow';
import { createSetupResult, finishSetupResult, type SiteSetupResult } from './setup-result';

const {
  getSiteActivity, createAgentsActivity, assignAccountManagerActivity, sendSetupFollowUpEmailActivity,
} = proxyActivities<Activities>({ startToCloseTimeout: '5 minutes', retry: { maximumAttempts: 3 } });

/** Missing optional data skips only its dependent step; failures preserve other progress. */
export async function runMinimumSiteSetup(params: SiteSetupParams): Promise<SiteSetupResult> {
  const result = createSetupResult(params.site_id);
  const siteInfo = await getSiteActivity(params.site_id);
  if (!siteInfo.success || !siteInfo.site || siteInfo.site.id !== params.site_id) {
    throw new Error('An existing site is required for setup');
  }
  const site = siteInfo.site;
  // An actor hint is not proof that the site has a persisted owner.
  const userId = site.user_id;
  const companyName = site.name?.trim() || params.company_name?.trim() || '';
  const contactEmail = params.contact_email?.trim();
  const contactName = params.contact_name?.trim() || companyName;
  const validEmail = contactEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail);
  const steps = result.steps!;

  if (!userId) {
    steps.agents = { status: 'skipped', reason: 'missing_user_id' };
  } else {
    try {
      const agents = await createAgentsActivity({
        site_id: site.id, user_id: userId, company_name: companyName,
        agent_types: getAgentTypes(),
        custom_config: { agents_config: defaultAgentsConfig.agents, use_detailed_config: true },
      });
      result.agents_created = {
        success: agents.success, total_created: agents.total_created, agents: agents.agents,
      };
      result.agents_existing = agents.total_existing ?? 0;
      steps.agents = agents.success
        ? { status: 'completed' }
        : { status: agents.agents.length ? 'partial' : 'failed', reason: 'agent_creation_incomplete' };
    } catch (error) {
      if (isCancellation(error)) throw error;
      steps.agents = { status: 'failed', reason: 'agent_creation_failed' };
    }
  }

  if (params.options?.enable_leads === false) {
    steps.segments = { status: 'skipped', reason: 'disabled' };
  } else if (!site.url?.trim()) {
    steps.segments = { status: 'skipped', reason: 'missing_site_url' };
  } else if (!userId) {
    steps.segments = { status: 'skipped', reason: 'missing_user_id' };
  } else {
    try {
      // Let the existing segment pipeline resolve real context and provider defaults.
      const child = await startChild(buildSegmentsWorkflow, {
        args: [{ site_id: site.id, siteId: site.id, userId, segmentCount: 5, mode: 'create' }],
        workflowId: `setup-segments-${site.id}-${Date.now()}`, workflowRunTimeout: '1 hour',
      });
      const segments = await child.result();
      result.segments_created = {
        success: segments.success, segments_built: segments.segmentsBuilt || 0,
        site_url: segments.siteUrl, mode: segments.mode, execution_time: segments.executionTime,
        ...(!segments.success && { error: 'Segment setup did not complete' }),
      };
      steps.segments = segments.success ? { status: 'completed' }
        : { status: segments.segmentsBuilt > 0 ? 'partial' : 'failed', reason: 'segment_creation_incomplete' };
    } catch (error) {
      if (isCancellation(error)) throw error;
      steps.segments = { status: 'failed', reason: 'segment_creation_failed' };
      result.segments_created.error = 'Segment setup did not complete';
    }
  }

  if (!validEmail || !userId) {
    steps.account_manager = { status: 'skipped', reason: !userId ? 'missing_user_id' : 'missing_contact_email' };
  } else {
    try {
      const manager = await assignAccountManagerActivity({
        site_id: site.id, user_id: userId, company_name: companyName,
        contact_email: contactEmail!, contact_name: contactName,
      });
      result.account_manager_assigned = manager;
      steps.account_manager = manager.success ? { status: 'completed' }
        : manager.skipped ? { status: 'skipped', reason: manager.skipped_reason || 'account_manager_unavailable' }
        : { status: 'failed', reason: 'account_manager_assignment_failed' };
    } catch (error) {
      if (isCancellation(error)) throw error;
      steps.account_manager = { status: 'failed', reason: 'account_manager_assignment_failed' };
    }
  }

  if (params.options?.enable_email_tracking === false) {
    steps.follow_up_email = { status: 'skipped', reason: 'disabled' };
  } else if (!validEmail) {
    steps.follow_up_email = { status: 'skipped', reason: 'missing_contact_email' };
  } else {
    try {
      const email = await sendSetupFollowUpEmailActivity({
        site_id: site.id, company_name: companyName, contact_email: contactEmail!, contact_name: contactName,
        account_manager: result.account_manager_assigned.account_manager,
        agents_created: result.agents_created.agents.map(({ type, name }) => ({ type, name })),
        next_steps: params.custom_requirements,
      });
      result.follow_up_email_sent = email;
      steps.follow_up_email = email.success ? { status: 'completed' }
        : email.unconfirmed ? { status: 'skipped', reason: 'setup_email_delivery_unconfirmed' }
        : email.skipped ? { status: 'skipped', reason: email.skipped_reason || 'email_unavailable' }
        : { status: 'failed', reason: 'follow_up_email_failed' };
    } catch (error) {
      if (isCancellation(error)) throw error;
      steps.follow_up_email = { status: 'failed', reason: 'follow_up_email_failed' };
    }
  }
  return finishSetupResult(result);
}