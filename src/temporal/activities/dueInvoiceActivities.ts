import { getSupabaseService } from '../services/supabaseService';
import { apiService } from '../services/apiService';
import { localOutreachDay, resolveOutreachConfiguration } from '../utils/outreachConfiguration';
import { invoiceDate } from '../utils/invoiceDueDate';

export interface DueInvoiceCursor { due_date: string; id: string }
export interface DueInvoiceCandidate { id: string; site_id: string; due_date: string }
export interface DueInvoicePage {
  invoices: DueInvoiceCandidate[];
  nextCursor?: DueInvoiceCursor;
  hasMore: boolean;
  localDate?: string;
}
export interface DueInvoiceReminderResult {
  success: boolean;
  skipped?: boolean;
  reason?: string;
  message_id?: string;
  command_id?: string;
}

/** Fetch only explicitly enabled, non-archived tenants; embedded site settings are not authoritative. */
export async function fetchDueInvoiceSitesActivity(): Promise<string[]> {
  const service = getSupabaseService();
  const sites = (await service.fetchSites()).filter(site => !site.archived_at);
  if (!sites.length) return [];
  const settings = await service.fetchCompleteSettings(sites.map(site => site.id));
  const active = new Set(settings.filter(row => row.activities?.invoices_due?.status === 'active').map(row => row.site_id));
  return sites.filter(site => active.has(site.id)).map(site => site.id);
}

/** Keyset pagination visits later invoices even when earlier ones are inside their repeat interval. */
export async function fetchDueInvoicePageActivity(params: {
  site_id: string;
  cursor?: DueInvoiceCursor;
}): Promise<DueInvoicePage> {
  const service = getSupabaseService();
  const settings = await service.fetchCompleteSettings([params.site_id]);
  const configuration = resolveOutreachConfiguration(settings.find(row => row.site_id === params.site_id), 'invoices_due');
  if (!configuration.shouldExecute) return { invoices: [], hasMore: false };
  const localDate = localOutreachDay(new Date(), configuration.timezone).date;
  let query = service.getClient().from('sales').select('id, site_id, due_date')
    .eq('site_id', params.site_id).eq('status', 'pending').gt('amount_due', 0).lte('due_date', localDate);
  if (params.cursor) {
    const date = invoiceDate(params.cursor.due_date);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.cursor.id)) {
      throw new Error('Invalid due invoice cursor');
    }
    query = query.or(`due_date.gt.${date},and(due_date.eq.${date},id.gt.${params.cursor.id})`);
  }
  const { data, error } = await query.order('due_date').order('id').limit(100);
  if (error) throw new Error(`Failed to fetch due invoices: ${error.message}`);
  const invoices = (data || []) as DueInvoiceCandidate[];
  const last = invoices[invoices.length - 1];
  return { invoices, localDate, hasMore: invoices.length === 100,
    ...(last ? { nextCursor: { due_date: last.due_date, id: last.id } } : {}) };
}

/** The API rereads payment/configuration and owns the atomic per-invoice reminder claim. */
export async function remindDueInvoiceActivity(params: {
  site_id: string;
  sale_id: string;
  reminder_key: string;
}): Promise<DueInvoiceReminderResult> {
  const response = await apiService.post<DueInvoiceReminderResult>('/api/agents/sales/dueInvoices', {
    ...params, outreach_activity: 'invoices_due',
  });
  if (!response.success || !response.data) {
    throw new Error(response.error?.message || 'Invoice reminder could not be confirmed');
  }
  return response.data;
}