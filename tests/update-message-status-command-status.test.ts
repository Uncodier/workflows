import {
  buildDeliveryStatusCustomData,
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
