import { resolveWebhookEventNames } from '../src/temporal/workflows/helpers/webhookEventName';

describe('resolveWebhookEventNames', () => {
  it('delivers a singular canonical event while accepting the legacy plural name', () => {
    expect(resolveWebhookEventNames({
      table: 'deals',
      eventType: 'DELETE',
      event: 'deals.deleted',
    })).toEqual({
      canonical: 'deal.deleted',
      candidates: ['deal.deleted', 'deals.deleted'],
    });
  });

  it('normalizes database operation names', () => {
    expect(resolveWebhookEventNames({
      table: 'reservations',
      eventType: 'INSERT',
    })).toEqual({
      canonical: 'reservation.created',
      candidates: ['reservation.created', 'reservations.created'],
    });
  });

  it('does not duplicate an already singular table event', () => {
    expect(resolveWebhookEventNames({
      table: 'content',
      eventType: 'UPDATE',
    })).toEqual({
      canonical: 'content.updated',
      candidates: ['content.updated'],
    });
  });
});
