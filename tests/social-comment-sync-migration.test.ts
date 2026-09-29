import { readFileSync } from 'fs';
import { join } from 'path';

const sql = readFileSync(join(__dirname, '../supabase/migrations/20260929010000_social_comment_sync_state.sql'), 'utf8')
  .replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim();

describe('social comment sync state migration source contract', () => {
  it('creates a durable site/post/network key with cascading site ownership', () => {
    expect(sql).toMatch(/CREATE TABLE public\.social_comment_sync_state\s*\(/i);
    expect(sql).toMatch(/site_id uuid NOT NULL REFERENCES public\.sites\(id\) ON DELETE CASCADE/i);
    expect(sql).toMatch(/PRIMARY KEY \(site_id, outstand_post_id, network\)/i);
    expect(sql).toMatch(/last_success_at timestamptz NOT NULL DEFAULT now\(\)/i);
  });

  it('restricts the table to service-only select, insert, and update', () => {
    expect(sql).toContain('ALTER TABLE public.social_comment_sync_state ENABLE ROW LEVEL SECURITY;');
    expect(sql).toContain('REVOKE ALL ON TABLE public.social_comment_sync_state FROM PUBLIC, anon, authenticated, service_role;');
    expect(sql.match(/GRANT [^;]+;/gi)).toEqual([
      'GRANT SELECT, INSERT, UPDATE ON TABLE public.social_comment_sync_state TO service_role;',
    ]);
    expect(sql).not.toMatch(/CREATE POLICY/i);
  });

  it('requires canonical, nonempty keys', () => {
    expect(sql).toContain("CHECK (btrim(outstand_post_id) <> '')");
    expect(sql).toContain("network <> '' AND network = lower(btrim(network)) AND network <> 'twitter'");
  });

  it('is transactional and does not backfill unverified success', () => {
    expect(sql).toMatch(/^BEGIN;/i);
    expect(sql).toMatch(/COMMIT;$/i);
    expect(sql).not.toMatch(/\b(?:INSERT INTO|UPDATE|DELETE FROM|DROP TABLE|TRUNCATE TABLE) public\./i);
  });
});