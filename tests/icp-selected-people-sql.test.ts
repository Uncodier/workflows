import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

it('isolated PostgreSQL proves selected ACK idempotency, attribution, quotas and cursor preservation', () => {
  const root = resolve(__dirname, '..');
  const script = String.raw`
    const { PGlite } = require(process.argv[1]);
    const { readFileSync } = require('node:fs'); const { resolve } = require('node:path');
    (async () => {
      const db = new PGlite(); const read = p => readFileSync(resolve(process.argv[2],p),'utf8');
      try {
        await db.exec(read('tests/icp-dispatcher-schema-fixture.sql'));
        await db.exec(read('tests/icp-selected-auth-fixture.sql'));
        await db.exec(read('supabase/migrations/20260929230000_icp_mining_execution_checkpoints.sql'));
        await db.exec(read('supabase/migrations/20261002010000_icp_dispatcher.sql'));
        await db.exec(read('supabase/migrations/20261006230000_icp_identity_reviews_no_cooldown.sql'));
        await db.exec(read('../API/supabase/migrations/20261117203000_finder_list_ownership.sql'));
        await db.exec(read('../API/supabase/migrations/20261117220000_finder_selected_list_members.sql'));
        for (const file of ['20261117221000_icp_selected_people_consumption.sql','20261117221100_icp_selected_people_dispatch.sql','20261117221200_icp_selected_people_claim_payload.sql']) await db.exec(read('supabase/migrations/'+file));
        await db.exec(read('supabase/migrations/20261119220000_finder_selected_identity_and_recovery.sql'));
        await db.exec(read('tests/icp-selected-people.sql'));
        await db.exec(read('tests/icp-selected-legacy-counters.sql'));
        await db.exec(read('tests/icp-selected-recovery.sql'));
        console.log('passed');
      } finally { await db.close(); }
    })().catch(error => { console.error(error); process.exitCode=1; });
  `;
  const result = spawnSync(process.execPath, ['-e', script, resolve(root, '../API/node_modules/@electric-sql/pglite'), root], {
    encoding: 'utf8', timeout: 90_000, env: { PATH: process.env.PATH, HOME: process.env.HOME },
  });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || result.error?.message);
  expect(result.stdout.trim()).toBe('passed');
}, 100_000);