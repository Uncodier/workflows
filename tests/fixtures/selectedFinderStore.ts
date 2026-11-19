import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { localPglite } from './localPglite';

/** Test-only transport for the small PostgREST surface used by selected Finder
 * activities. Filters, writes, uniqueness, row checks, and RPCs run in real PG. */
export async function selectedFinderStore() {
  const db = localPglite();
  const sql = (source: string, args: any[] = []) => db.query(source, args);
  // Each mocked HTTP statement is independent; isolate its PG error from the
  // outer test transaction so the next activity can re-read the winning row.
  const request = async (statement: string, args: unknown[]) => {
    await sql('SAVEPOINT finder_http');
    try { return await sql(statement, args); }
    catch (error) { await sql('ROLLBACK TO SAVEPOINT finder_http'); throw error; }
    finally { await sql('RELEASE SAVEPOINT finder_http'); }
  };
  const sqlId = (key: string) => {
    if (!/^[a-z_][a-z_0-9]*$/.test(key)) throw new Error(`Invalid fixture identifier: ${key}`);
    return `"${key}"`;
  };
  const param = (value: unknown) => value && typeof value === 'object' ? JSON.stringify(value) : value;
  const hooks: { beforeRpc?: (name: string) => Promise<void>; beforeContactCheck?: () => Promise<void> } = {};
  const rpc = async (name: string, inputs: Record<string, unknown>) => {
    try {
      await hooks.beforeRpc?.(name);
      const entries = Object.entries(inputs);
      const { rows } = await request(`SELECT ${sqlId(name)}(${entries.map(([key], i) => `${sqlId(key)} => $${i + 1}`).join(',')}) AS data`,
        entries.map(([, value]) => param(value)));
      return { data: rows[0].data, error: null };
    } catch (error) { return { data: null, error }; }
  };
  const from = (table: string) => {
    const filters: [string, unknown][] = [];
    let columns = '*', limit = '', order = '', op = 'select', payload: Record<string, unknown> = {};
    const query: any = {
      select(value = '*') { columns = value; return query; },
      order(key: string, { ascending = true } = {}) { order = ` ORDER BY ${sqlId(key)} ${ascending ? 'ASC' : 'DESC'}`; return query; },
      limit(n: number) { limit = ` LIMIT ${Number(n)}`; return query; },
      eq(key: string, value: unknown) { filters.push([key, value]); return query; },
      insert(value: Record<string, unknown>) { op = 'insert'; payload = value; return query; },
      update(value: Record<string, unknown>) { op = 'update'; payload = value; return query; },
    };
    const execute = async (mode?: 'single' | 'maybe') => {
      const args: unknown[] = [];
      const value = (v: unknown) => `$${args.push(param(v))}`;
      try {
        const where = filters.length ? ` WHERE ${filters.map(([k, v]) => `${k.split('.').map(sqlId).join('.')} = ${value(v)}`).join(' AND ')}` : '';
        const include = ',persons!leads_person_id_fkey!inner(id)';
        const left = ',persons!leads_person_id_fkey(id,finder_selected_person_id,numeric_id:external_person_id::text)';
        const contactCheck = columns.endsWith(left);
        if (contactCheck) await hooks.beforeContactCheck?.();
        const join = columns.endsWith(include) ? ' JOIN persons ON persons.id=leads.person_id'
          : contactCheck ? ' LEFT JOIN persons ON persons.id=leads.person_id' : '';
        const selected = columns.replace(include, '').replace(left, '');
        let projection = selected === '*' ? '*' : selected.split(',').map(c => `${sqlId(table)}.${sqlId(c.trim())}`).join(',');
        if (contactCheck) projection += `, CASE WHEN persons.id IS NOT NULL THEN jsonb_build_object('id',persons.id,
          'finder_selected_person_id',persons.finder_selected_person_id,'numeric_id',persons.external_person_id::text) END AS persons`;
        let statement = `SELECT ${projection} FROM ${sqlId(table)}${join}${where}${order}${limit}`;
        const fields = Object.entries(payload).filter(([,v]) => v !== undefined);
        if (op === 'insert') statement = `INSERT INTO ${sqlId(table)}(${fields.map(([k]) => sqlId(k))}) VALUES (${fields.map(([,v]) => value(v))}) RETURNING *`;
        if (op === 'update') statement = `UPDATE ${sqlId(table)} SET ${fields.map(([k,v]) => `${sqlId(k)}=${value(v)}`)}${where} RETURNING *`;
        const { rows } = await request(statement, args);
        if (mode && (rows.length > 1 || (mode === 'single' && !rows.length))) throw new Error('Expected single fixture row');
        // Supabase uses JSON.parse: emulate lossy BIGINT decoding only on return.
        for (const row of rows) if (row.external_person_id != null) row.external_person_id = Number(row.external_person_id);
        return { data: mode ? rows[0] ?? null : rows, error: null };
      } catch (error) { return { data: null, error }; }
    };
    query.single = () => execute('single'); query.maybeSingle = () => execute('maybe');
    query.then = (yes: Function, no: Function) => execute().then(yes as any, no as any);
    return query;
  };
  const root = resolve(__dirname, '../..');
  try {
    for (const file of ['tests/icp-dispatcher-schema-fixture.sql', 'tests/icp-selected-auth-fixture.sql',
      'supabase/migrations/20260929230000_icp_mining_execution_checkpoints.sql', 'supabase/migrations/20261002010000_icp_dispatcher.sql',
      'supabase/migrations/20261006230000_icp_identity_reviews_no_cooldown.sql', '../API/supabase/migrations/20261117203000_finder_list_ownership.sql',
      '../API/supabase/migrations/20261117220000_finder_selected_list_members.sql', 'supabase/migrations/20261117221000_icp_selected_people_consumption.sql',
      'supabase/migrations/20261117221100_icp_selected_people_dispatch.sql', 'supabase/migrations/20261117221200_icp_selected_people_claim_payload.sql',
      'supabase/migrations/20261119220000_finder_selected_identity_and_recovery.sql']) {
      await db.exec(readFileSync(resolve(root, file), 'utf8'));
    }
    // Only extend the shared fixture's minimal persons table with baseline Finder columns.
    await db.exec(`ALTER TABLE persons ALTER COLUMN id SET DEFAULT gen_random_uuid(), ADD COLUMN full_name text,
      ADD COLUMN emails jsonb, ADD COLUMN personal_emails jsonb[], ADD COLUMN phones jsonb, ADD COLUMN raw_result jsonb,
      ADD COLUMN created_at timestamptz DEFAULT now(), ADD COLUMN updated_at timestamptz DEFAULT now(),
      ADD CONSTRAINT uniq_persons_ext UNIQUE(external_person_id,external_role_id);
      ALTER TABLE leads RENAME CONSTRAINT leads_site_id_name_email_key TO leads_site_name_email_unique;`);
  } catch (error) { await db.close(); throw error; }
  return { sql, from, rpc, hooks, close: () => db.close() };
}
