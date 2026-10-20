import { continueAsNew, proxyActivities, sleep, workflowInfo } from '@temporalio/workflow';
import type * as activities from '../activities/catalogIndexActivities';
import { catalogScope, invalidCatalogInput, type CatalogIndexInput } from '../utils/catalogIndexContracts';

export type { CatalogIndexInput } from '../utils/catalogIndexContracts';

const { backfillCatalogIndexActivity, processCatalogIndexActivity } = proxyActivities<typeof activities>({
  startToCloseTimeout: '240s',
  scheduleToCloseTimeout: '15m',
  retry: {
    maximumAttempts: 3,
    initialInterval: '10s',
    backoffCoefficient: 2,
    maximumInterval: '60s',
    nonRetryableErrorTypes: [
      'CATALOG_INDEX_INVALID_INPUT', 'CATALOG_INDEX_INVALID_RESPONSE', 'CATALOG_INDEX_REQUEST_REJECTED',
    ],
  },
});

export interface CatalogIndexResult {
  success: true;
  data: {
    state: 'idle' | 'deferred';
    pages: number;
    batches: number;
    enqueued: number;
    processed: number;
    failed: number;
    stale: number;
  };
  error: null;
}

/** Serial, bounded outbox orchestrator. No vectors/documents or queue snapshots in history. */
export async function catalogIndexWorkflow(input: CatalogIndexInput = {}): Promise<CatalogIndexResult> {
  const scope = catalogScope(input);
  if ((input.backfill !== undefined && typeof input.backfill !== 'boolean')
    || (scope.after_id !== undefined && input.backfill !== true)) {
    return invalidCatalogInput();
  }
  let backfill = input.backfill === true;
  let after_id = scope.after_id;
  const counts = { pages: 0, batches: 0, enqueued: 0, processed: 0, failed: 0, stale: 0 };

  for (let iteration = 1; ; iteration++) {
    if (backfill) {
      const response = await backfillCatalogIndexActivity({
        ...(scope.site_id ? { site_id: scope.site_id } : {}),
        ...(after_id ? { after_id } : {}),
        limit: 100,
      });
      counts.pages++;
      counts.enqueued += response.processed;
      backfill = response.has_more;
      after_id = backfill ? response.next_cursor! : undefined;
    } else {
      const response = await processCatalogIndexActivity({ limit: 8 });
      counts.batches++;
      counts.processed += response.processed;
      counts.failed += response.failed;
      counts.stale += response.stale;
      // Delayed retries remain in DB. Even an inconsistent remaining=true must not spin.
      const deferred = response.failed > 0 || (response.remaining
        && response.processed + response.stale + (response.refreshed || 0) === 0);
      if (deferred || !response.remaining) {
        return { success: true, data: { state: deferred ? 'deferred' : 'idle', ...counts }, error: null };
      }
    }

    await sleep('1s');
    if (iteration >= 25 || workflowInfo().continueAsNewSuggested) {
      // Preserve phase + last confirmed cursor only; never restart completed backfill.
      return continueAsNew<typeof catalogIndexWorkflow>({
        ...(scope.site_id ? { site_id: scope.site_id } : {}),
        backfill,
        ...(backfill && after_id ? { after_id } : {}),
      });
    }
  }
}