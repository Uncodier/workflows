import { createHash } from 'crypto';
import { Context } from '@temporalio/activity';
import { apiService } from '../services/apiService';

/** Run/activity identity is stable across retries, unlike attempt/task tokens. */
export function setupEmailOperationKey(siteId: string): string {
  const info = Context.current().info;
  const identity = [info.workflowNamespace, info.workflowExecution.workflowId,
    info.workflowExecution.runId, info.activityId, siteId.toLowerCase()];
  if (identity.some(value => typeof value !== 'string' || !value)) throw new Error('Missing Temporal activity identity');
  return `setup-email-v1:${createHash('sha256').update(JSON.stringify(identity)).digest('hex')}`;
}

export async function dispatchSetupEmailFromActivity(payload: {
  site_id: string; email: string; subject: string; message: string;
}) {
  // Dedicated worker secret, never a caller hint/history argument or browser key.
  const credential = process.env.SETUP_EMAIL_SERVICE_API_KEY?.trim();
  if (!credential) return { success: true, data: { status: 'skipped', reason: 'setup_email_service_unconfigured' } };
  const operation_key = setupEmailOperationKey(payload.site_id);
  return apiService.request('/api/site/setup/email', {
    method: 'POST', body: { ...payload, operation_key }, headers: { 'x-api-key': credential }, timeout: 120_000,
  });
}