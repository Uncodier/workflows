import { ApplicationFailure } from '@temporalio/common';
import { apiService } from '../services/apiService';
import {
  catalogLimit, catalogScope, invalidCatalogInput, isCatalogUuid,
  type CatalogIndexBackfillInput, type CatalogIndexBackfillResult,
  type CatalogIndexProcessResult,
} from '../utils/catalogIndexContracts';

function invalidResponse(): never {
  throw ApplicationFailure.nonRetryable(
    'Invalid catalog indexing API response', 'CATALOG_INDEX_INVALID_RESPONSE'
  );
}

function isCount(value: unknown, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max;
}

/** One HTTP attempt only. Temporal owns bounded retries; never retain raw API errors. */
async function requestCatalog(endpoint: string, body: object): Promise<Record<string, unknown>> {
  let response;
  try {
    response = await apiService.request<unknown>(endpoint, {
      method: 'POST', body, timeout: 210_000,
    });
  } catch {
    throw ApplicationFailure.retryable('Catalog indexing request failed', 'CATALOG_INDEX_REQUEST_FAILED');
  }

  if (!response || response.success !== true) {
    const status = response?.error?.status;
    const permanent = typeof status === 'number' && status >= 400 && status < 500
      && ![408, 409, 425, 429].includes(status);
    throw ApplicationFailure.create({
      message: 'Catalog indexing API request unsuccessful',
      type: permanent ? 'CATALOG_INDEX_REQUEST_REJECTED' : 'CATALOG_INDEX_REQUEST_FAILED',
      nonRetryable: permanent,
    });
  }

  // apiService wraps the API's flat {success, counters...} body in data.
  const result = response.data;
  if (!result || typeof result !== 'object' || Array.isArray(result)) return invalidResponse();
  const candidate = result as Record<string, unknown>;
  if (candidate.success === false) {
    throw ApplicationFailure.retryable('Catalog indexing API operation failed', 'CATALOG_INDEX_REQUEST_FAILED');
  }
  if (candidate.success !== true || (candidate.error !== undefined && candidate.error !== null)) {
    return invalidResponse();
  }
  return candidate;
}

/** Enqueue a keyset page; retrying the same page is safe at the database boundary. */
export async function backfillCatalogIndexActivity(
  input: CatalogIndexBackfillInput = {}
): Promise<CatalogIndexBackfillResult> {
  const scope = catalogScope(input);
  const limit = catalogLimit(input.limit, 100, 200);
  const response = await requestCatalog('/api/catalog/index/backfill', { ...scope, limit });
  if (!isCount(response.processed, limit) || typeof response.has_more !== 'boolean'
    || (response.next_cursor !== null && !isCatalogUuid(response.next_cursor))) {
    return invalidResponse();
  }
  const cursor = typeof response.next_cursor === 'string' ? response.next_cursor.toLowerCase() : null;
  if (response.has_more && (!cursor
    || (scope.after_id !== undefined && cursor <= scope.after_id))) {
    return invalidResponse();
  }
  // Explicit whitelist: no documents, embeddings, upstream errors or arbitrary metadata.
  return { success: true, processed: response.processed, next_cursor: cursor, has_more: response.has_more };
}

/** The API owns claim/lease, embedding and CAS completion. This activity sees counters only. */
export async function processCatalogIndexActivity(
  input: { limit?: number } = {}
): Promise<CatalogIndexProcessResult> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return invalidCatalogInput();
  const limit = catalogLimit(input.limit, 8, 20);
  const response = await requestCatalog('/api/catalog/index/process', { limit });
  const stale = response.stale === undefined ? 0 : response.stale;
  const refreshed = response.refreshed === undefined ? undefined : response.refreshed;
  if (!isCount(response.processed, limit) || !isCount(response.failed, limit)
    || !isCount(stale, limit) || (refreshed !== undefined && !isCount(refreshed, 100))
    || typeof response.remaining !== 'boolean') {
    return invalidResponse();
  }
  return { success: true, processed: response.processed, failed: response.failed, stale,
    ...(refreshed !== undefined ? { refreshed: refreshed as number } : {}), remaining: response.remaining };
}