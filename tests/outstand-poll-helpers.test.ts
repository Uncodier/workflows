import {
  normalizeOutstandNetwork,
  isAccountPublished,
  isOutstandDraftPost,
  getPublishedCommentNetworks,
  buildOutstandCommentsPath,
  isPublishedContentForAnalytics,
  isOutstandClientError,
  extractOutstandPostText,
} from '../src/temporal/workflows/helpers/outstandPoll';
import { handleOutstandApiError } from '../src/temporal/activities/outstandHelpers';

describe('outstandPoll helpers', () => {
  describe('normalizeOutstandNetwork', () => {
    it('normalizes twitter to x', () => {
      expect(normalizeOutstandNetwork('twitter')).toBe('x');
      expect(normalizeOutstandNetwork('Twitter ')).toBe('x');
    });

    it('passes through other networks', () => {
      expect(normalizeOutstandNetwork('instagram')).toBe('instagram');
      expect(normalizeOutstandNetwork('linkedin')).toBe('linkedin');
      expect(normalizeOutstandNetwork('Facebook')).toBe('facebook');
    });

    it('handles empty cases safely', () => {
      expect(normalizeOutstandNetwork('')).toBe('');
      expect(normalizeOutstandNetwork(null)).toBe('');
      expect(normalizeOutstandNetwork(undefined)).toBe('');
    });
  });

  describe('buildOutstandCommentsPath', () => {
    it('includes tenant_id and normalized network', () => {
      const path = buildOutstandCommentsPath('site-1', 'cFRzL', 'twitter');
      expect(path).toBe('/api/integrations/outstand/posts/cFRzL/comments?tenant_id=site-1&network=x');
    });
  });

  describe('isAccountPublished', () => {
    it('returns true if status is published', () => {
      expect(isAccountPublished({ status: 'published' })).toBe(true);
    });

    it('returns true if publishedAt is present', () => {
      expect(isAccountPublished({ status: 'pending', publishedAt: '2023-01-01' })).toBe(true);
    });

    it('returns true if platformPostId is present', () => {
      expect(isAccountPublished({ status: 'pending', platformPostId: '123' })).toBe(true);
    });

    it('returns false for draft or purely pending accounts', () => {
      expect(isAccountPublished({ status: 'pending' })).toBe(false);
      expect(isAccountPublished({ status: 'failed' })).toBe(false);
      expect(isAccountPublished(null)).toBe(false);
      expect(isAccountPublished({})).toBe(false);
    });
  });

  describe('post eligibility', () => {
    it('excludes drafts and pending-only accounts', () => {
      expect(isOutstandDraftPost({ isDraft: true })).toBe(true);
      expect(isOutstandDraftPost({ status: 'draft' })).toBe(true);
      expect(getPublishedCommentNetworks({
        socialAccounts: [{ network: 'instagram', status: 'pending' }],
      })).toEqual([]);
    });

    it('includes published supported accounts and normalizes twitter', () => {
      expect(getPublishedCommentNetworks({
        isDraft: false,
        socialAccounts: [
          { network: 'twitter', status: 'published' },
          { network: 'tiktok', status: 'published' },
          { network: 'instagram', status: 'pending' },
        ],
      })).toEqual(['x']);
    });
  });

  describe('isPublishedContentForAnalytics', () => {
    it('ignores drafts and scheduled content', () => {
      expect(isPublishedContentForAnalytics({ status: 'draft' })).toBe(false);
      expect(isPublishedContentForAnalytics({ status: 'approved' })).toBe(false);
      expect(isPublishedContentForAnalytics({ status: 'published' })).toBe(true);
      expect(isPublishedContentForAnalytics({ status: 'draft', published_at: '2026-01-01' })).toBe(true);
    });
  });

  describe('extractOutstandPostText', () => {
    it('prefers containers content over text', () => {
      expect(extractOutstandPostText({ containers: [{ content: 'hello' }], text: 'fallback' })).toBe('hello');
      expect(extractOutstandPostText({ text: 'fallback' })).toBe('fallback');
      expect(extractOutstandPostText({})).toBe('');
    });
  });

  describe('handleOutstandApiError', () => {
    it('returns a non-retryable error for 400 Bad Request', () => {
      const err = handleOutstandApiError('fetch', new Error('API call failed: 400 Bad Request'));
      expect(err.message).toContain('fetch failed');
      expect((err as any).type).toBe('OUTSTAND_CLIENT_ERROR');
      expect((err as any).nonRetryable).toBe(true);
    });

    it('treats Vercel-wrapped Outstand 400 as non-retryable', () => {
      const wrapped =
        'API call failed: 500 Internal Server Error. {"error":"Outstand API Error: 400 Bad Request - Post is not published."}';
      expect(isOutstandClientError(wrapped)).toBe(true);
      const err = handleOutstandApiError('fetch', wrapped);
      expect((err as any).nonRetryable).toBe(true);
    });

    it('returns a non-retryable error for 404 Not Found', () => {
      const err = handleOutstandApiError('fetch', new Error('API call failed: 404 Not Found'));
      expect((err as any).nonRetryable).toBe(true);
    });

    it('returns a standard error for 500 errors', () => {
      const err = handleOutstandApiError('fetch', new Error('API call failed: 500 Internal Server Error'));
      expect(err).toBeInstanceOf(Error);
      expect((err as any).nonRetryable).toBeUndefined();
    });
  });
});
