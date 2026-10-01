import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Run: npm test -- --runInBand tests/icp-dispatcher-sql.test.ts
// Requires the EXISTING sibling API/node_modules/@electric-sql/pglite install.
// No added dependency, app imports, network, database credentials or production.
// PGlite verifies real PostgreSQL semantics but cannot prove multi-session races;
// the fixture also checks that every ownership RPC uses the SAME lock before rows.
const root = resolve(__dirname, '..');
const pglite = resolve(root, '../API/node_modules/@electric-sql/pglite');
const cases = readFileSync(resolve(__dirname, 'icp-dispatcher.sql'), 'utf8')
  .split(/^-- case: /m).slice(1).map(part => part.slice(0, part.indexOf('\n')).trim());

describe('ICP dispatcher isolated SQL', () => {
  let passed: string[];
  beforeAll(() => {
    if (!existsSync(pglite)) {
      throw new Error('SQL fixture requires existing sibling API/node_modules/@electric-sql/pglite (no new Workflows dependency).');
    }
    const script = String.raw`
      const { PGlite } = require(process.argv[1]);
      const { readFileSync } = require('node:fs');
      const { resolve } = require('node:path');
      (async () => {
        const root = process.argv[2];
        const db = new PGlite();
        const read = path => readFileSync(resolve(root, path), 'utf8');
        try {
          await db.exec(read('tests/icp-dispatcher-schema-fixture.sql'));
          await db.exec(read('supabase/migrations/20260929230000_icp_mining_execution_checkpoints.sql'));
          await db.exec(read('supabase/migrations/20261002010000_icp_dispatcher.sql'));
          const parts = read('tests/icp-dispatcher.sql').split(/^-- case: /m);
          await db.exec(parts.shift());
          const passed = [];
          for (const part of parts) {
            const name = part.slice(0, part.indexOf('\n')).trim();
            try { await db.exec(part.slice(part.indexOf('\n'))); }
            catch (error) { throw new Error(name + ': ' + error.message + '\n' + (error.where || '')); }
            passed.push(name);
          }
          console.log(JSON.stringify(passed));
        } finally { await db.close(); }
      })().catch(error => { console.error(error); process.exitCode = 1; });
    `;
    const result = spawnSync(process.execPath, ['-e', script, pglite, root], {
      cwd: root, encoding: 'utf8', timeout: 90_000, maxBuffer: 4 * 1024 * 1024,
      env: { PATH: process.env.PATH, HOME: process.env.HOME },
    });
    if (result.status !== 0) throw new Error(result.stderr || result.error?.message || result.stdout);
    passed = JSON.parse(result.stdout.trim());
  }, 100_000);

  test.each(cases)('%s', name => expect(passed).toContain(name));
});