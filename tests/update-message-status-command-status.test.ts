import {
  buildDeliveryStatusCustomData,
  selectUnsentAssistantForDeliveryUpdate,
  shouldSkipDeliveryStatusUpdate,
} from '../src/temporal/activities/updateMessageStatusMapping';

describe('updateMessageStatusToSentActivity custom_data mapping', () => {
  const baseRequest = {
    delivery_channel: 'whatsapp' as const,
    lead_id: 'lead-1',
    site_id: 'site-1',
  };

  it('sets command_status failed and error_message after definitive send failure', () => {
    const updated = buildDeliveryStatusCustomData(
      { command_status: 'pending', status: 'pending' },
      {
        ...baseRequest,
        delivery_success: false,
        delivery_details: { error: 'Template send exhausted retries' },
      }
    );

    expect(updated.status).toBe('failed');
    expect(updated.command_status).toBe('failed');
    expect(updated.error_message).toBe('Template send exhausted retries');
    expect(updated.follow_up.processed).toBe(true);
  });

  it('sets command_status success and clears error_message on delivery success', () => {
    const updated = buildDeliveryStatusCustomData(
      { command_status: 'pending', status: 'pending', error_message: 'previous' },
      {
        ...baseRequest,
        delivery_success: true,
        delivery_details: { channel: 'whatsapp' },
      }
    );

    expect(updated.status).toBe('sent');
    expect(updated.command_status).toBe('success');
    expect(updated.error_message).toBeUndefined();
  });

  it('does not overwrite a later sent with an older fail', () => {
    expect(
      shouldSkipDeliveryStatusUpdate(
        { status: 'sent', follow_up: { processed: true } },
        false
      )
    ).toBe(true);

    expect(
      shouldSkipDeliveryStatusUpdate(
        { status: 'sent', command_status: 'success' },
        false
      )
    ).toBe(true);

    expect(
      shouldSkipDeliveryStatusUpdate(
        { status: 'pending', command_status: 'pending' },
        false
      )
    ).toBe(false);
  });
});

describe('selectUnsentAssistantForDeliveryUpdate', () => {
  it('selects the only unsent assistant', () => {
    const selected = selectUnsentAssistantForDeliveryUpdate([
      { id: 'user-1', role: 'user', custom_data: {} },
      { id: 'asst-1', role: 'assistant', custom_data: {} },
    ]);

    expect(selected).toBe('asst-1');
  });

  it('returns none when two unsent assistants exist', () => {
    const selected = selectUnsentAssistantForDeliveryUpdate([
      { id: 'asst-new', role: 'assistant', custom_data: {} },
      { id: 'asst-greeting', role: 'assistant', custom_data: {} },
    ]);

    expect(selected).toBeUndefined();
  });

  it('returns none for user-only rows', () => {
    const selected = selectUnsentAssistantForDeliveryUpdate([
      { id: 'user-1', role: 'user', custom_data: {} },
      { id: 'user-2', role: 'user' },
    ]);

    expect(selected).toBeUndefined();
  });

  it('skips already sent assistants', () => {
    expect(
      selectUnsentAssistantForDeliveryUpdate([
        { id: 'asst-sent', role: 'assistant', custom_data: { status: 'sent' } },
      ])
    ).toBeUndefined();

    expect(
      selectUnsentAssistantForDeliveryUpdate([
        {
          id: 'asst-delivered',
          role: 'assistant',
          custom_data: { delivery: { success: true } },
        },
        { id: 'asst-pending', role: 'assistant', custom_data: { status: 'pending' } },
      ])
    ).toBe('asst-pending');
  });
});
