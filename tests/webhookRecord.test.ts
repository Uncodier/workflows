import { resolveWebhookRecord } from '../src/temporal/workflows/helpers/webhookRecord';

describe('resolveWebhookRecord', () => {
  it('uses the database event snapshot without refetching the row', async () => {
    const fetchRecord = jest.fn();
    const record = { id: 'deleted-record', site_id: 'site-1' };

    await expect(resolveWebhookRecord({
      record,
      table: 'deals',
      objectId: 'deleted-record',
      fetchRecord,
    })).resolves.toBe(record);
    expect(fetchRecord).not.toHaveBeenCalled();
  });

  it('fetches the row for legacy workflow calls without a snapshot', async () => {
    const storedRecord = { id: 'existing-record', site_id: 'site-1' };
    const fetchRecord = jest.fn().mockResolvedValue(storedRecord);

    await expect(resolveWebhookRecord({
      table: 'deals',
      objectId: 'existing-record',
      fetchRecord,
    })).resolves.toBe(storedRecord);
    expect(fetchRecord).toHaveBeenCalledWith({
      table: 'deals',
      id: 'existing-record',
    });
  });
});
