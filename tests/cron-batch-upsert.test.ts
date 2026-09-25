import { batchUpsertCronStatus } from '../src/temporal/services/supabase-impl/cron';

describe('batchUpsertCronStatus', () => {
  it('writes all records in one atomic upsert and normalizes status', async () => {
    const upsert = jest.fn().mockResolvedValue({ error: null });
    const from = jest.fn().mockReturnValue({ upsert });
    const client = { from } as any;

    await batchUpsertCronStatus(client, [
      {
        site_id: 'site-1',
        activity_name: 'syncEmailsWorkflow',
        status: 'running',
      },
      {
        site_id: 'site-2',
        activity_name: 'syncEmailsWorkflow',
        status: 'COMPLETED',
      },
    ]);

    expect(from).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledWith('cron_status');
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ site_id: 'site-1', status: 'RUNNING' }),
        expect.objectContaining({ site_id: 'site-2', status: 'COMPLETED' }),
      ]),
      {
        onConflict: 'site_id,activity_name',
        ignoreDuplicates: false,
      }
    );
  });

  it('does not contact the database for an empty batch', async () => {
    const from = jest.fn();

    await batchUpsertCronStatus({ from } as any, []);

    expect(from).not.toHaveBeenCalled();
  });
});
