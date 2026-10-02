import { ApplicationFailure } from '@temporalio/common';
import { apiService } from '../services/apiService';
import { handleOutstandApiError } from './outstandHelpers';
import { extractSocialCommentResponse } from './socialCommentResponse';
import { durableLinkedInComment } from '../workflows/helpers/socialCommentIdentity';
import { buildOutstandCommentsPath, normalizeOutstandNetwork } from '../workflows/helpers/outstandPoll';

export async function fetchOutstandPostRepliesActivity(
  siteId: string, postId: string, network: string,
  options?: { username?: string; durableIdentity?: boolean; accountId?: string }
): Promise<any> {
  const isLinkedIn = normalizeOutstandNetwork(network) === 'linkedin';
  const requestOptions = isLinkedIn ? { ...options, durableIdentity: true } : options;
  let response;
  try {
    response = await apiService.get(buildOutstandCommentsPath(siteId, postId, network, requestOptions));
  } catch (error) {
    if (isLinkedIn) {
      // Do not attach an upstream body/cause to the durable activity failure.
      throw ApplicationFailure.create({ message: 'LinkedIn comments request failed', type: 'OUTSTAND_COMMENTS_ERROR' });
    }
    throw error;
  }
  if (!response.success) {
    if (isLinkedIn) {
      const status = response.error?.status;
      throw ApplicationFailure.create({
        message: `LinkedIn comments request failed${typeof status === 'number' ? ` (HTTP ${status})` : ''}`,
        type: 'OUTSTAND_COMMENTS_ERROR',
        nonRetryable: typeof status === 'number' && status >= 400 && status < 500 && status !== 429 && status !== 408,
      });
    }
    throw handleOutstandApiError(`fetchOutstandPostReplies for post ${postId}`, response.error?.message);
  }
  const comments = extractSocialCommentResponse(response);
  // Activity results become durable Temporal history. Do not return LinkedIn
  // profiles even if a provider unexpectedly resolves them without opting in.
  return isLinkedIn
    ? comments.map(durableLinkedInComment) : comments;
}

