import {
  isTemplateRejectedFailure,
  parseApiErrorTypeFromMessage,
  shouldRetrySendTemplate,
  TEMPLATE_REJECTED_ERROR_TYPE,
} from '../src/temporal/workflows/helpers/whatsappTemplateRejection';

const API_400_REJECTED =
  'Failed to send WhatsApp template: API call failed: 400 Bad Request. {"success":false,"status":"failed","error":"WhatsApp template approval is terminal (rejected). Do not retry this template.","error_type":"TEMPLATE_REJECTED"}';

const API_400_PENDING =
  'Failed to send WhatsApp template: API call failed: 400 Bad Request. {"success":false,"status":"failed","error":"Template not approved after waiting 60s. Status: pending. Please try again in a few minutes."}';

describe('whatsappTemplateRejection', () => {
  it('parses error_type from an apiService 400 message', () => {
    expect(parseApiErrorTypeFromMessage(API_400_REJECTED)).toBe(TEMPLATE_REJECTED_ERROR_TYPE);
    expect(parseApiErrorTypeFromMessage(API_400_PENDING)).toBeNull();
    expect(parseApiErrorTypeFromMessage('network timeout')).toBeNull();
  });

  it('treats TEMPLATE_REJECTED as non-retryable', () => {
    expect(isTemplateRejectedFailure(new Error(API_400_REJECTED))).toBe(true);
    expect(isTemplateRejectedFailure({ type: TEMPLATE_REJECTED_ERROR_TYPE, message: 'rejected' })).toBe(true);
    expect(shouldRetrySendTemplate(new Error(API_400_REJECTED))).toBe(false);
  });

  it('does not backoff when Temporal wraps the rejection in ActivityFailure', () => {
    const activityFailure = {
      message: 'Activity task failed',
      activityType: 'sendTemplateActivity',
      cause: {
        type: TEMPLATE_REJECTED_ERROR_TYPE,
        message: API_400_REJECTED,
        nonRetryable: true,
      },
    };
    expect(isTemplateRejectedFailure(activityFailure)).toBe(true);
    expect(shouldRetrySendTemplate(activityFailure)).toBe(false);
  });

  it('keeps pending approval errors on the backoff loop', () => {
    expect(isTemplateRejectedFailure(new Error(API_400_PENDING))).toBe(false);
    expect(shouldRetrySendTemplate(new Error(API_400_PENDING))).toBe(true);
    expect(shouldRetrySendTemplate(new Error('WhatsApp template sending failed: timeout'))).toBe(true);
  });
});
