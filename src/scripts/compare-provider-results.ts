/*
  Compare our email validation against a provider CSV.
  Env:
    - PROVIDER_RESULTS_CSV=/abs/path/to/file.csv (required)
    - PROVIDER_ROW_TIMEOUT_MS=20000 (optional)
    - OUTPUT_CSV=/abs/path/to/output.csv (optional)
*/

import fs from 'fs';
import path from 'path';

import { checkDomainExists, getMXRecords } from '@/lib/email-validation';
import { testSMTPConnectivityActivity, validateEmail } from '@/temporal/activities/validateEmailActivities';

type ProviderRow = {
  email: string;
  result: string; // 'valid' | 'invalid' | 'unknown' | 'catchall'
  flags: string[]; // lowercased flags from provider
};

type Mismatch = { email: string; field: string; expected: any; got: any };

function ensure(value: string | undefined, name: string): string {
  if (!value || !value.trim()) throw new Error(`${name} is required`);
  return value;
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function parseCsv(filePath: string): ProviderRow[] {
  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];

  const header = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const emailIdx = header.findIndex((h) => h === 'email');
  const resultIdx = header.findIndex((h) => h === 'result');
  const flagsIdx = header.findIndex((h) => h === 'flags');
  if (emailIdx < 0 || resultIdx < 0 || flagsIdx < 0) {
    throw new Error('CSV must contain headers: Email, Result, Flags');
  }

  const rows: ProviderRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const email = (cols[emailIdx] || '').trim();
    const result = (cols[resultIdx] || '').trim().toLowerCase();
    const flagsStr = (cols[flagsIdx] || '').trim();
    const flags = flagsStr
      .split(';')
      .flatMap((s) => s.split('|'))
      .flatMap((s) => s.split(','))
      .map((f) => f.trim().toLowerCase())
      .filter((f) => !!f);
    if (email) rows.push({ email, result, flags });
  }
  return rows;
}

function hasFlag(flags: string[], name: string): boolean {
  const set = new Set(flags.map((f) => f.toLowerCase()));
  return set.has(name.toLowerCase());
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout after ${ms}ms @ ${label}`)), ms);
  });
  try {
    const raced: Promise<T> = Promise.race([promise, timeout]) as Promise<T>;
    const result = await raced;
    clearTimeout(timer!);
    return result;
  } catch (e) {
    clearTimeout(timer!);
    throw e;
  }
}

async function main() {
  const csvPath = ensure(process.env.PROVIDER_RESULTS_CSV, 'PROVIDER_RESULTS_CSV');
  const rowTimeout = Number(process.env.PROVIDER_ROW_TIMEOUT_MS || '20000');
  const outPath = process.env.OUTPUT_CSV
    ? path.resolve(process.env.OUTPUT_CSV)
    : path.resolve(process.cwd(), `comparison-results-${Date.now()}.csv`);

  const rows = parseCsv(csvPath);
  if (rows.length === 0) {
    console.log('No rows in CSV. Nothing to do.');
    return;
  }

  const mismatches: Mismatch[] = [];
  let processed = 0;

  console.log(`Starting comparison for ${rows.length} rows...`);

  for (const row of rows) {
    processed++;
    const domain = row.email.split('@')[1];
    process.stdout.write(`→ [${processed}/${rows.length}] ${row.email} ... `);

    try {
      const expHasDns = hasFlag(row.flags, 'has_dns');
      const expHasMx = hasFlag(row.flags, 'has_dns_mx');
      const expSmtp = hasFlag(row.flags, 'smtp_connectable');

      const domainCheck = await withTimeout(checkDomainExists(domain), rowTimeout, `${row.email}:dns`);
      const mxRecords = expHasDns
        ? await withTimeout(getMXRecords(domain).catch(() => [] as any), rowTimeout, `${row.email}:mx`)
        : [];
      const smtpConnectivity = await withTimeout(
        testSMTPConnectivityActivity({ email: row.email }),
        rowTimeout,
        `${row.email}:smtp_connect`
      );

      const gotHasDns = domainCheck.exists;
      const gotHasMx = Array.isArray(mxRecords) && mxRecords.length > 0;
      const gotSmtp = smtpConnectivity.success === true;

      if (expHasDns !== gotHasDns) mismatches.push({ email: row.email, field: 'has_dns', expected: expHasDns, got: gotHasDns });
      if (expHasMx !== gotHasMx) mismatches.push({ email: row.email, field: 'has_dns_mx', expected: expHasMx, got: gotHasMx });
      if (expSmtp !== gotSmtp) mismatches.push({ email: row.email, field: 'smtp_connectable', expected: expSmtp, got: gotSmtp });

      const our = await withTimeout(
        validateEmail({ email: row.email, aggressiveMode: false }),
        Math.max(rowTimeout, 45000),
        `${row.email}:full`
      );
      const ourData = our.data!;

      let ourComparable = (ourData.result || '').toLowerCase();
      if (row.result === 'valid' && gotSmtp && ourComparable === 'risky') ourComparable = 'valid';
      if (row.result !== ourComparable) mismatches.push({ email: row.email, field: 'result', expected: row.result, got: ourData.result });

      process.stdout.write('OK\n');
    } catch (err: any) {
      process.stdout.write(`ERROR (${err?.message || err})\n`);
      mismatches.push({ email: row.email, field: 'execution', expected: 'success', got: err?.message || String(err) });
    }
  }

  // Write CSV summary
  const header = 'email,field,expected,got';
  const lines = mismatches.map((m) => [m.email, m.field, JSON.stringify(m.expected), JSON.stringify(m.got)].join(','));
  const csvOut = [header, ...lines].join('\n');
  fs.writeFileSync(outPath, csvOut, 'utf8');

  console.log(`\nCompleted. Processed: ${processed}. Mismatches: ${mismatches.length}.`);
  console.log(`Report: ${outPath}`);
}

main().catch((err) => {
  console.error('Comparison failed:', err);
  process.exit(1);
});


