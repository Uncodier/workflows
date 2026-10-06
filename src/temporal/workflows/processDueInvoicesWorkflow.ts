import { ApplicationFailure, proxyActivities } from '@temporalio/workflow';
import type { Activities } from '../activities';
import type { DueInvoiceCursor } from '../activities/dueInvoiceActivities';

const { fetchDueInvoiceSitesActivity, fetchDueInvoicePageActivity } = proxyActivities<Activities>({
  startToCloseTimeout: '5m', retry: { maximumAttempts: 3 },
});
// Never replay ambiguous generation/provider calls automatically. The persisted
// invoice claim also protects later polling executions and manual API retries.
const { remindDueInvoiceActivity } = proxyActivities<Activities>({
  startToCloseTimeout: '10m', retry: { maximumAttempts: 1 },
});

export async function processDueInvoicesWorkflow(): Promise<{ processed: number; skipped: number; errors: number }> {
  const summary = { processed: 0, skipped: 0, errors: 0 };
  const sites = await fetchDueInvoiceSitesActivity();
  for (const site_id of sites) {
    try {
      let cursor: DueInvoiceCursor | undefined;
      for (;;) {
        const page = await fetchDueInvoicePageActivity({ site_id, ...(cursor ? { cursor } : {}) });
        for (const invoice of page.invoices) {
          try {
            const result = await remindDueInvoiceActivity({ site_id, sale_id: invoice.id,
              reminder_key: `invoice-due:${invoice.id}:${page.localDate}` });
            if (result.skipped) summary.skipped++;
            else if (result.success) summary.processed++;
            else summary.errors++;
          } catch (error) {
            console.error(`Invoice reminder failed for ${invoice.id}`, error);
            summary.errors++;
          }
        }
        if (!page.hasMore) break;
        if (!page.nextCursor || (cursor?.id === page.nextCursor.id && cursor.due_date === page.nextCursor.due_date)) {
          throw new Error('Due invoice pagination did not advance');
        }
        cursor = page.nextCursor;
      }
    } catch (error) {
      console.error(`Due invoice polling failed for site ${site_id}`, error);
      summary.errors++;
    }
  }
  if (summary.errors) {
    throw ApplicationFailure.nonRetryable('Some due invoice reminders failed', 'DUE_INVOICE_REMINDERS_FAILED', summary);
  }
  return summary;
}