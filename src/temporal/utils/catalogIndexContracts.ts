import { ApplicationFailure } from '@temporalio/common';

export interface CatalogIndexInput {
  site_id?: string;
  backfill?: boolean;
  after_id?: string;
}

export interface CatalogIndexBackfillInput {
  site_id?: string;
  after_id?: string;
  limit?: number;
}

export interface CatalogIndexBackfillResult {
  success: true;
  processed: number;
  next_cursor: string | null;
  has_more: boolean;
}

export interface CatalogIndexProcessResult {
  success: true;
  processed: number;
  failed: number;
  stale: number;
  refreshed?: number;
  remaining: boolean;
}

export function isCatalogUuid(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export function invalidCatalogInput(): never {
  // Do not echo caller input into errors/history.
  throw ApplicationFailure.nonRetryable('Invalid catalog indexing input', 'CATALOG_INDEX_INVALID_INPUT');
}

export function catalogLimit(value: unknown, fallback: number, max: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > max) {
    return invalidCatalogInput();
  }
  return value;
}

export function catalogScope(input: { site_id?: string; after_id?: string }): {
  site_id?: string; after_id?: string;
} {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || (input.site_id !== undefined && !isCatalogUuid(input.site_id))
    || (input.after_id !== undefined && !isCatalogUuid(input.after_id))) {
    return invalidCatalogInput();
  }
  return {
    ...(input.site_id !== undefined ? { site_id: input.site_id.toLowerCase() } : {}),
    ...(input.after_id !== undefined ? { after_id: input.after_id.toLowerCase() } : {}),
  };
}