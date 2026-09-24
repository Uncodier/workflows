const TABLE_EVENT_NAMES: Readonly<Record<string, string>> = {
  content: 'content',
  conversations: 'conversation',
  deals: 'deal',
  leads: 'lead',
  messages: 'message',
  quotations: 'quotation',
  records: 'record',
  reservations: 'reservation',
  sales: 'sale',
  tasks: 'task',
};

function eventSuffix(eventType: string): string {
  const normalized = eventType.toLowerCase();
  if (normalized === 'create' || normalized === 'created' || normalized === 'insert') {
    return 'created';
  }
  if (normalized === 'update' || normalized === 'updated' || normalized === 'modify') {
    return 'updated';
  }
  if (normalized === 'delete' || normalized === 'deleted' || normalized === 'remove') {
    return 'deleted';
  }
  return normalized;
}

export function resolveWebhookEventNames(params: {
  table: string;
  eventType: string;
  event?: string;
}): { canonical: string; candidates: string[] } {
  const explicitSuffix = params.event?.split('.').at(-1);
  const suffix = eventSuffix(explicitSuffix || params.eventType);
  const resource = TABLE_EVENT_NAMES[params.table] || params.table;
  const canonical = `${resource}.${suffix}`;
  const legacyTableEvent = `${params.table}.${suffix}`;

  return {
    canonical,
    candidates: Array.from(new Set([canonical, legacyTableEvent])),
  };
}
