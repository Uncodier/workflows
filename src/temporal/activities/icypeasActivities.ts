import { apiService } from '../services/apiService';
import { Context } from '@temporalio/activity';
import { resolveIcyPeasEmail } from './icypeas/resolveEmail';

export interface LookEmailOnIcyPeasOptions {
  domainOrCompany: string;
  firstname?: string;
  lastname?: string;
  customobject?: any;
  site_id?: string;
}

export interface LookEmailOnIcyPeasResult {
  success: boolean;
  data?: {
    email: string;
    confidence?: number;
    status: string;
    [key: string]: any;
  };
  error?: string;
  searchId?: string;
  outcome?: 'matched' | 'no_match' | 'pending' | 'failed';
}

/**
 * Activity to search for an email using IcyPeas integration
 */
export async function lookEmailOnIcyPeas(
  options: LookEmailOnIcyPeasOptions
): Promise<LookEmailOnIcyPeasResult> {
  let context: Context | undefined;
  try { context = Context.current(); } catch { /* Also callable in offline tests. */ }
  return resolveIcyPeasEmail(options, {
    request: (body, timeout) => apiService.request('/api/integrations/icypeas/email-search/resolve', {
      method: 'POST', body, timeout, signal: context?.cancellationSignal,
    }),
    sleep: ms => context ? context.sleep(ms) : new Promise(resolve => setTimeout(resolve, ms)),
    now: Date.now,
    signal: context?.cancellationSignal,
  });
}
