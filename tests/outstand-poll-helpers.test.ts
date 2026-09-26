import {
  buildSocialCommentExternalId,
  buildSocialCommentWorkflowId,
  buildSocialPostExternalId,
  normalizeOutstandNetwork,
  isAccountPublished,
  isOutstandDraftPost,
  getConnectedCommentAccounts,
  isImportAccountOwnedBySite,
  getOwnedPublishedCommentAccounts,
  getPostSiteOwnerships,
  getUnambiguousPostSiteOwnerships,
  getPublishedCommentNetworks,
  buildOutstandCommentsPath,
  isPublishedContentForAnalytics,
  isOutstandClientError,
  extractOutstandPostText,
  shouldPollPostForAnalytics,
  shouldPollPostForComments,
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

  describe('stable social ingestion identifiers', () => {
    it('builds the same comment key on every poll', () => {
      expect(buildSocialCommentExternalId('Twitter', 'comment-123')).toBe(
        'outstand:x:comment-123'
      );
      expect(buildSocialCommentExternalId('x', 'comment-123')).toBe(
        'outstand:x:comment-123'
      );
    });

    it('keeps identical provider IDs separate across networks', () => {
      expect(buildSocialCommentExternalId('facebook', '123')).not.toBe(
        buildSocialCommentExternalId('instagram', '123')
      );
    });

    it('builds bounded deterministic workflow IDs', () => {
      const longCommentId = `urn:${'comment:'.repeat(80)}`;
      const first = buildSocialCommentWorkflowId('site-1', 'linkedin', longCommentId);
      const second = buildSocialCommentWorkflowId('site-1', 'linkedin', longCommentId);

      expect(first).toBe(second);
      expect(first.length).toBeLessThanOrEqual(240);
      expect(first).toMatch(/^[a-zA-Z0-9._-]+$/);
    });

    it('builds stable post keys', () => {
      expect(buildSocialPostExternalId(' post-123 ')).toBe('outstand:post-123');
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

    it('keeps only posts owned by an active connected account', () => {
      const socialMedia = [
        {
          id: 'Lm3jV',
          platform: 'instagram',
          network: 'instagram',
          isActive: true,
          network_unique_id: '28519188847732336',
        },
      ];
      const ownedAccount = {
        accountId: 'Lm3jV',
        network: 'instagram',
        status: 'published',
        platformPostId: 'instagram-post-1',
      };

      expect(getOwnedPublishedCommentAccounts({
        socialAccounts: [
          ownedAccount,
          {
            id: 'z9bIP',
            network: 'linkedin',
            status: 'published',
            platformPostId: 'urn:li:share:7503888783185117184',
          },
        ],
      }, socialMedia)).toEqual([ownedAccount]);
    });

    it('rejects same-network posts owned by another account', () => {
      const socialMedia = [{
        id: 'site-instagram-account',
        network: 'instagram',
        isActive: true,
      }];

      expect(getOwnedPublishedCommentAccounts({
        socialAccounts: [{
          id: 'different-instagram-account',
          network: 'instagram',
          status: 'published',
          platformPostId: 'instagram-post-1',
        }],
      }, socialMedia)).toEqual([]);
    });

    it('maps a shared-organization post only to its owning site', () => {
      const post = {
        socialAccounts: [{
          id: 'makinari-linkedin-account',
          network: 'linkedin',
          status: 'published',
          platformPostId: 'urn:li:share:7504314017792995328',
        }],
      };
      const sites = [
        {
          site_id: 'pigs-site',
          social_media: [{
            id: 'pigs-instagram-account',
            network: 'instagram',
            isActive: true,
          }],
        },
        {
          site_id: 'makinari-site',
          social_media: [{
            id: 'makinari-linkedin-account',
            network: 'linkedin',
            isActive: true,
          }],
        },
      ];

      expect(getPostSiteOwnerships(post, sites)).toEqual([{
        siteId: 'makinari-site',
        socialAccounts: post.socialAccounts,
      }]);
    });

    it('rejects an account configured as active by multiple sites', () => {
      const account = { id: 'shared-account', network: 'linkedin', status: 'published' };
      expect(getUnambiguousPostSiteOwnerships({ socialAccounts: [account] }, [
        { site_id: 'first', social_media: [{ ...account, isActive: true }] },
        { site_id: 'second', social_media: [{ ...account, isActive: true }] },
      ])).toEqual([]);
    });

    it('preserves the legacy mapping and site order for pre-patch histories', () => {
      const account = { id: 'shared-account', network: 'linkedin', status: 'published' };
      const sites = [
        { site_id: 'second', social_media: [{ ...account, isActive: true }] },
        { site_id: 'first', social_media: [{ ...account, isActive: true }] },
      ];
      expect(getPostSiteOwnerships({ socialAccounts: [account] }, sites)).toEqual([
        { siteId: 'second', socialAccounts: [account] },
        { siteId: 'first', socialAccounts: [account] },
      ]);
    });

    it('keeps uniquely owned post accounts when another account is ambiguous', () => {
      const shared = { id: 'shared', network: 'linkedin', status: 'published' };
      const owned = { id: 'owned', network: 'instagram', status: 'published' };
      expect(getUnambiguousPostSiteOwnerships({ socialAccounts: [shared, owned] }, [
        { site_id: 'first', social_media: [shared, owned].map(account => ({ ...account, isActive: true })) },
        { site_id: 'second', social_media: [{ ...shared, isActive: true }] },
      ])).toEqual([{ siteId: 'first', socialAccounts: [owned] }]);
    });

    it('matches legacy Facebook pages by platform post prefix', () => {
      const socialMedia = [{
        platform: 'facebook',
        isActive: true,
        connectedPages: [{ id: '101600695973502' }],
      }];
      const facebookAccount = {
        network: 'facebook',
        status: 'published',
        platformPostId: '101600695973502_1047007201431553',
      };

      expect(getOwnedPublishedCommentAccounts({
        socialAccounts: [facebookAccount],
      }, socialMedia)).toEqual([facebookAccount]);
    });

    it('ignores descriptive profiles without an active connection identity', () => {
      expect(getConnectedCommentAccounts([
        {
          platform: 'linkedin',
          url: 'https://linkedin.com/company/example',
          username: 'example',
        },
      ])).toEqual([]);
    });

    it('imports history only for an active account actually connected to the site', () => {
      const connected = [{
        id: 'owned-account', network: 'linkedin', isActive: true,
        network_unique_id: 'urn:li:organization:owner',
      }];
      expect(isImportAccountOwnedBySite({
        id: 'owned-account', network: 'linkedin', isActive: true,
      }, connected)).toBe(true);
      expect(isImportAccountOwnedBySite({
        id: 'other-account', network: 'linkedin', isActive: true,
      }, connected)).toBe(false);
      expect(isImportAccountOwnedBySite({
        id: 'owned-account', network: 'facebook', isActive: true,
      }, connected)).toBe(false);
      expect(isImportAccountOwnedBySite({
        id: 'owned-account', network: 'linkedin', isActive: false,
      }, connected)).toBe(false);
      expect(isImportAccountOwnedBySite({
        id: 'owned-account', network: 'linkedin', isActive: true,
      }, [{ ...connected[0], isActive: false }])).toBe(false);
      expect(isImportAccountOwnedBySite({
        id: 'owned-account', network: 'linkedin', isActive: true,
      }, null)).toBe(false);
    });

    it('matches a legacy connected Facebook page without trusting an unrelated page', () => {
      const connected = [{
        platform: 'facebook', isActive: true,
        connectedPages: [{ id: 'owner-page' }],
      }];
      expect(isImportAccountOwnedBySite({
        id: 'outstand-account', network: 'facebook',
        connectedPages: [{ id: 'owner-page' }],
      }, connected)).toBe(true);
      expect(isImportAccountOwnedBySite({
        id: 'outstand-account', network: 'facebook',
        connectedPages: [{ id: 'another-page' }],
      }, connected)).toBe(false);
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

  describe('shouldPollPostForAnalytics', () => {
    const now = Date.UTC(2026, 8, 24, 12, 0, 0);

    it('uses the six-hour refresh interval when publication time is missing', () => {
      expect(shouldPollPostForAnalytics(null, now, null)).toBe(true);
      expect(
        shouldPollPostForAnalytics(
          null,
          now,
          new Date(now - 5 * 60 * 60 * 1000).toISOString()
        )
      ).toBe(false);
      expect(
        shouldPollPostForAnalytics(
          null,
          now,
          new Date(now - 6 * 60 * 60 * 1000).toISOString()
        )
      ).toBe(true);
    });
  });

  describe('shouldPollPostForComments', () => {
    const now = Date.UTC(2026, 8, 24, 6, 0, 0);

    it('polls posts newer than one day on every five-minute run', () => {
      const post = { publishedAt: new Date(now - 12 * 60 * 60 * 1000).toISOString() };

      expect(shouldPollPostForComments(post, now).shouldPoll).toBe(true);
      expect(shouldPollPostForComments(post, now + 5 * 60 * 1000).shouldPoll).toBe(true);
    });

    it('polls one bucket every six hours for posts up to seven days old', () => {
      const post = { publishedAt: new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString() };

      expect(shouldPollPostForComments(post, now).shouldPoll).toBe(true);
      expect(shouldPollPostForComments(post, now + 5 * 60 * 1000).shouldPoll).toBe(false);
      expect(shouldPollPostForComments(post, now + 6 * 60 * 60 * 1000).shouldPoll).toBe(true);
    });

    it('retains the legacy hourly window for Temporal replay', () => {
      const post = { publishedAt: new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString() };

      expect(
        shouldPollPostForComments(post, now + 5 * 60 * 1000, false).shouldPoll
      ).toBe(true);
    });

    it('polls one bucket per day for posts between seven and thirty days old', () => {
      const post = { publishedAt: new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString() };
      const midnight = Date.UTC(2026, 8, 25, 0, 0, 0);

      expect(shouldPollPostForComments(post, midnight).shouldPoll).toBe(true);
      expect(shouldPollPostForComments(post, midnight + 5 * 60 * 1000).shouldPoll).toBe(false);
      expect(shouldPollPostForComments(post, midnight + 24 * 60 * 60 * 1000).shouldPoll).toBe(true);
    });

    it('stops polling posts older than thirty days', () => {
      const post = { publishedAt: new Date(now - 31 * 24 * 60 * 60 * 1000).toISOString() };

      expect(shouldPollPostForComments(post, now)).toEqual({
        shouldPoll: false,
        isTooOld: true,
      });
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
