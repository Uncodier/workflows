export async function resolveWebhookRecord(params: {
  record?: unknown;
  table: string;
  objectId: string;
  fetchRecord: (request: { table: string; id: string }) => Promise<unknown>;
}): Promise<unknown> {
  if (params.record !== undefined && params.record !== null) {
    return params.record;
  }

  return params.fetchRecord({
    table: params.table,
    id: params.objectId,
  });
}
