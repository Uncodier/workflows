import { ApplicationFailure } from '@temporalio/common';
import { isOutstandClientError } from '../workflows/helpers/outstandPoll';

export {
  normalizeOutstandNetwork,
  isAccountPublished,
  isOutstandDraftPost,
  getPublishedCommentNetworks,
  buildOutstandCommentsPath,
  isPublishedContentForAnalytics,
  isOutstandClientError,
  extractOutstandPostText,
} from '../workflows/helpers/outstandPoll';

/**
 * Maps Outstand/Vercel client errors to a non-retryable ApplicationFailure
 * so Temporal does not retry 400/404 forever.
 */
export function handleOutstandApiError(operation: string, error: any): Error {
  const message = error instanceof Error ? error.message : String(error);

  if (isOutstandClientError(message)) {
    return ApplicationFailure.create({
      message: `${operation} failed: ${message}`,
      type: 'OUTSTAND_CLIENT_ERROR',
      nonRetryable: true,
    });
  }

  if (error instanceof Error) {
    error.message = `${operation} failed: ${error.message}`;
    return error;
  }

  return new Error(`${operation} failed: ${message}`);
}
