import { ApplicationFailure } from '@temporalio/common';

export interface LeadFollowUpApiError {
  code?: string;
  message?: string;
  status?: number;
}

export interface ParsedLeadFollowUpError {
  code: string;
  message: string;
  status?: number;
  details?: unknown;
  rawMessage: string;
}

const RETRYABLE_CLIENT_STATUSES = new Set([408, 409, 425, 429]);
const NON_RETRYABLE_CODES = new Set([
  'INVALID_REQUEST',
  'LEAD_NOT_FOUND',
  'NO_VALID_CHANNELS',
  'NO_VALID_CHANNELS_FOR_LEAD',
]);

function embeddedBackendError(message: string): Record<string, unknown> | undefined {
  const jsonStart = message.indexOf('{');
  if (jsonStart < 0) return undefined;

  try {
    const payload = JSON.parse(message.slice(jsonStart));
    if (!payload || typeof payload !== 'object') return undefined;

    const error = (payload as { error?: unknown }).error;
    return error && typeof error === 'object'
      ? error as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

export function parseLeadFollowUpApiError(
  error: LeadFollowUpApiError | undefined
): ParsedLeadFollowUpError {
  const rawMessage = error?.message || 'Failed to execute lead follow-up';
  const backendError = embeddedBackendError(rawMessage);
  const statusFromMessage = rawMessage.match(/API call failed:\s*(\d{3})/i)?.[1];
  const backendCode = typeof backendError?.code === 'string' ? backendError.code : undefined;
  const backendMessage = typeof backendError?.message === 'string' ? backendError.message : undefined;

  return {
    code: backendCode || error?.code || 'LEAD_FOLLOW_UP_API_FAILURE',
    message: backendMessage || rawMessage,
    status: error?.status ?? (statusFromMessage ? Number(statusFromMessage) : undefined),
    details: backendError?.details,
    rawMessage,
  };
}

export function isLeadFollowUpFailureNonRetryable(error: ParsedLeadFollowUpError): boolean {
  if (NON_RETRYABLE_CODES.has(error.code)) return true;

  return typeof error.status === 'number' &&
    error.status >= 400 &&
    error.status < 500 &&
    !RETRYABLE_CLIENT_STATUSES.has(error.status);
}

export function createLeadFollowUpApiFailure(
  error: LeadFollowUpApiError | undefined
): ApplicationFailure {
  const parsed = parseLeadFollowUpApiError(error);

  return ApplicationFailure.create({
    message: parsed.message,
    type: parsed.code,
    nonRetryable: isLeadFollowUpFailureNonRetryable(parsed),
    details: [{
      status: parsed.status,
      backendDetails: parsed.details,
      rawMessage: parsed.rawMessage,
    }],
  });
}
