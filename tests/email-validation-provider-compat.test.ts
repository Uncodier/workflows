import { checkDomainExists, getMXRecords } from '@/lib/email-validation';
import { testSMTPConnectivityActivity, validateEmail } from '@/temporal/activities/validateEmailActivities';
import * as fs from 'fs';
import * as path from 'path';

type ProviderRow = {
  email: string;
  result: string; // 'valid' | 'invalid' | 'unknown' | 'catchall'
  flags: string[]; // e.g., [has_dns, has_dns_mx, smtp_connectable, free_email_host]
};

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      // Toggle quotes; handle escaped quotes "" -> " inside field
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
        cur += '"';
        i++; // skip second quote
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

  // Find columns by header names (Email, Result, Flags)
  const header = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const emailIdx = header.findIndex((h) => h === 'email');
  const resultIdx = header.findIndex((h) => h === 'result');
  const flagsIdx = header.findIndex((h) => h === 'flags');
  if (emailIdx < 0 || resultIdx < 0 || flagsIdx < 0) {
    throw new Error('CSV must contain headers: Email, Result, Flags');
  }

  const rows: ProviderRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const cols = parseCsvLine(line);
    const email = (cols[emailIdx] || '').trim();
    const result = (cols[resultIdx] || '').trim().toLowerCase();
    const flagsStr = (cols[flagsIdx] || '').trim();
    const flags = flagsStr
      .split(';') // allow semicolon separated
      .flatMap((s) => s.split('|')) // allow pipe separated
      .flatMap((s) => s.split(',')) // and comma separated
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
    // race promise vs timeout
    const result = await Promise.race([promise, timeout]);
    // @ts-expect-error timer defined
    clearTimeout(timer);
    return result as T;
  } catch (e) {
    // @ts-expect-error timer defined
    clearTimeout(timer);
    throw e;
  }
}

describe('Email validation vs provider comparison', () => {
  const csvPath = process.env.PROVIDER_RESULTS_CSV
    ? path.resolve(process.env.PROVIDER_RESULTS_CSV)
    : '';

  const maxMismatches = Number(process.env.MAX_PROVIDER_MISMATCHES || '0');
  const perRowTimeoutMs = Number(process.env.PROVIDER_ROW_TIMEOUT_MS || '30000');

  (csvPath ? it : it.skip)(
    'compares our results against provider flags (DNS/MX/SMTP) and result',
    async () => {
      const rows = parseCsv(csvPath);
      expect(rows.length).toBeGreaterThan(0);

      const mismatches: Array<{ email: string; field: string; expected: any; got: any }> = [];

      for (const row of rows) {
        const domain = row.email.split('@')[1];
        // progress logs
        // eslint-disable-next-line no-console
        console.log(`→ Validating ${row.email}`);

        // Provider expected signals
        const expHasDns = hasFlag(row.flags, 'has_dns');
        const expHasMx = hasFlag(row.flags, 'has_dns_mx');
        const expSmtpConnect = hasFlag(row.flags, 'smtp_connectable');

        // Our signals (with per-row timeout guards)
        const domainCheck = await withTimeout(checkDomainExists(domain), perRowTimeoutMs, `${row.email}:dns`);
        const mxRecords = expHasDns
          ? await withTimeout(getMXRecords(domain).catch(() => [] as any), perRowTimeoutMs, `${row.email}:mx`)
          : [];
        const smtpConnectivity = await withTimeout(
          testSMTPConnectivityActivity({ email: row.email }),
          perRowTimeoutMs,
          `${row.email}:smtp_connect`
        );

        const gotHasDns = domainCheck.exists;
        const gotHasMx = Array.isArray(mxRecords) && mxRecords.length > 0;
        const gotSmtpConnect = smtpConnectivity.success === true;

        if (expHasDns !== gotHasDns) {
          mismatches.push({ email: row.email, field: 'has_dns', expected: expHasDns, got: gotHasDns });
        }
        if (expHasMx !== gotHasMx) {
          mismatches.push({ email: row.email, field: 'has_dns_mx', expected: expHasMx, got: gotHasMx });
        }
        if (expSmtpConnect !== gotSmtpConnect) {
          mismatches.push({ email: row.email, field: 'smtp_connectable', expected: expSmtpConnect, got: gotSmtpConnect });
        }

        // Our full validation
        const our = await withTimeout(
          validateEmail({ email: row.email, aggressiveMode: false }),
          Math.max(perRowTimeoutMs, 45000),
          `${row.email}:full`
        );
        const ourData = our.data!;

        // Result equivalence: treat our 'risky' as equivalent to provider 'valid' when we have smtp_connectable
        const providerResult = row.result;
        let ourComparable = (ourData.result || '').toLowerCase();
        if (providerResult === 'valid' && gotSmtpConnect && (ourComparable === 'risky')) {
          ourComparable = 'valid';
        }

        if (providerResult !== ourComparable) {
          mismatches.push({ email: row.email, field: 'result', expected: providerResult, got: ourData.result });
        }

        // eslint-disable-next-line no-console
        console.log(`✓ Done ${row.email}`);
      }

      if (mismatches.length > 0) {
        // eslint-disable-next-line no-console
        console.table(mismatches);
      }

      expect(mismatches.length).toBeLessThanOrEqual(maxMismatches);
    },
    180_000
  );
});


