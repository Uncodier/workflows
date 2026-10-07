import { dispatchSetupEmailFromActivity } from './siteSetupEmailProxy';
import { getSupabaseService } from '../services/supabaseService';
import { createAgent } from '../services/supabase-impl/agents';
import { CancelledFailure } from '@temporalio/activity';
import {
  buildSetupAgentRow, fetchSetupSite, findExistingSetupAgent, requireSetupUuid,
  setupAgentCandidates, setupAgentResult,
} from './siteSetupAgentHelpers';
import type {
  AssignAccountManagerParams, AssignAccountManagerResult, CreateAgentsParams,
  CreateAgentsResult, SendSetupFollowUpEmailParams, SendSetupFollowUpEmailResult,
} from './siteSetupTypes';

export type * from './siteSetupTypes';

/** Creates missing agents without changing existing configuration or status. */
export async function createAgentsActivity(params: CreateAgentsParams): Promise<CreateAgentsResult> {
  requireSetupUuid(params.site_id, 'site_id');
  const service = getSupabaseService();
  const client = service.getClient();
  const site = await fetchSetupSite(client, params.site_id);
  if (!site) throw new Error('Site not found');
  // The API actor may be a manager; persisted site ownership is authoritative.
  requireSetupUuid(site.user_id, 'Site owner user_id');
  const result: CreateAgentsResult = {
    success: false, agents: [], total_created: 0, total_existing: 0, partial: false, errors: [],
  };
  const candidates = setupAgentCandidates(params);
  if (!candidates.length) {
    result.errors.push('No agents were requested');
    return result;
  }
  const seen = new Set<string>();
  const consumed = new Set<string>();
  for (const candidate of candidates) {
    try {
      const row = buildSetupAgentRow(candidate, params.site_id, site.user_id, site.name);
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      const existing = await findExistingSetupAgent(client, row, consumed);
      if (existing) {
        result.agents.push(setupAgentResult(existing));
        consumed.add(existing.id);
        result.total_existing++;
        continue;
      }
      try {
        const created = await createAgent(client, row);
        result.agents.push(setupAgentResult(created));
        consumed.add(created.id);
        result.total_created++;
      } catch (error) {
        if (error instanceof CancelledFailure) throw error;
        // Recover a concurrent insert or a committed write with a lost response.
        const recovered = await findExistingSetupAgent(client, row, consumed);
        if (!recovered) throw error;
        result.agents.push(setupAgentResult(recovered));
        consumed.add(recovered.id);
        result.total_existing++;
      }
    } catch (error) {
      if (error instanceof CancelledFailure) throw error;
      result.errors.push(`${candidate.config?.name || candidate.config?.type || 'Agent'}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  result.success = result.errors.length === 0;
  result.partial = result.agents.length > 0 && !result.success;
  return result;
}

/** No account-manager assignment service exists in the current API. */
export async function assignAccountManagerActivity(_params: AssignAccountManagerParams): Promise<AssignAccountManagerResult> {
  return {
    success: false, skipped: true,
    skipped_reason: 'account_manager_api_unavailable',
    account_manager: { manager_id: '', name: '', email: '' }, assignment_date: '',
  };
}

/** Sends only through the real site-configured email implementation. */
export async function sendSetupFollowUpEmailActivity(params: SendSetupFollowUpEmailParams): Promise<SendSetupFollowUpEmailResult> {
  // Preserve legacy result fields; empty values never claim a recipient or send.
  const unsent = { success: false, messageId: '', recipient: '', timestamp: '' };
  const recipient = params.contact_email?.trim();
  if (!recipient) return { ...unsent, skipped: true, skipped_reason: 'missing_contact_email' };
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(recipient) || recipient === 'no-email@example.com') {
    return { ...unsent, skipped: true, skipped_reason: 'invalid_contact_email' };
  }
  requireSetupUuid(params.site_id, 'site_id');
  const agents = (params.agents_created ?? []).map(agent => `- ${agent.name} (${agent.type})`).join('\n');
  const steps = (params.next_steps ?? [
    'Configure the required integrations', 'Customize agent responses', 'Test the agents',
  ]).map((step, index) => `${index + 1}. ${step}`).join('\n');
  const manager = params.account_manager;
  const message = [
    params.contact_name?.trim() ? `Hello ${params.contact_name.trim()},` : 'Hello,',
    'Your initial site setup has been processed.',
    `Site ID: ${params.site_id}`,
    ...(params.company_name?.trim() ? [`Company: ${params.company_name.trim()}`] : []),
    ...(agents ? [`Agents available:\n${agents}`] : []),
    ...(manager?.name && manager.email ? [`Account manager: ${manager.name} (${manager.email})${manager.phone ? `, ${manager.phone}` : ''}`] : []),
    ...(steps ? [`Next steps:\n${steps}`] : []),
  ].join('\n\n');
  const response = await dispatchSetupEmailFromActivity({
    site_id: params.site_id, email: recipient,
    subject: params.company_name?.trim() ? `Site setup update for ${params.company_name.trim()}` : 'Site setup update',
    message,
  });
  const data = response.data;
  if (data?.status === 'skipped') return { ...unsent, skipped: true, skipped_reason: data.reason || 'email_provider_skipped' };
  if (data?.status === 'uncertain' || !response.success) {
    return { ...unsent, unconfirmed: true, skipped: true, skipped_reason: data?.reason || 'delivery_unconfirmed' };
  }
  if (!response.success || data?.success === false) {
    return { ...unsent, error: response.error?.message || data?.error?.message || 'Email sending failed' };
  }
  const messageId = data?.messageId;
  if (data?.status !== 'sent' || typeof messageId !== 'string' || !messageId.trim()
    || data.recipient !== recipient || typeof data.sent_at !== 'string' || !Number.isFinite(Date.parse(data.sent_at))) {
    return { ...unsent, unconfirmed: true, skipped: true, skipped_reason: 'delivery_unconfirmed' };
  }
  return { success: true, messageId, recipient, timestamp: data.sent_at };
}