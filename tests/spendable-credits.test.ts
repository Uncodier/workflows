import { spendableCredits } from '../src/temporal/utils/spendableCredits';

it.each([[0, 2, 2], [0.4, 0.6, 1], [.7, .1, .8], [.1, .2, .3], [2, null, 2], [0, null, 0],
  [2, -3, -1], [1e-7, 2e-7, 3e-7], [1, -.9999999999999999, 1e-16]])(
  'projects regular %s plus wallet %s', (regular, wallet, total) => {
    expect(spendableCredits({ credits_available: regular, account_balance: wallet })).toBe(total);
  },
);

it.each([undefined, NaN, Infinity, -Infinity, '2', '', true, false, {}, []])('fails closed on invalid balance %p', value => {
  expect(spendableCredits({ credits_available: value, account_balance: 5 })).toBeNull();
  expect(spendableCredits({ credits_available: 5, account_balance: value })).toBeNull();
});

it('rejects missing billing, null regular balance and overflowing totals', () => {
  expect(spendableCredits(null)).toBeNull();
  expect(spendableCredits(undefined)).toBeNull();
  expect(spendableCredits({ credits_available: null, account_balance: 5 })).toBeNull();
  expect(spendableCredits({ credits_available: -2, account_balance: 5 })).toBeNull();
  expect(spendableCredits({ credits_available: Number.MAX_VALUE, account_balance: Number.MAX_VALUE })).toBeNull();
});

const start = '2026-11-01T00:00:00Z';
const end = '2026-11-16T00:00:00Z';
describe.each([
  ['trial_credits_available', 'trial_started_at', 'trial_ends_at'],
  ['plan_credits_available', 'plan_credit_period_start', 'plan_credit_period_end'],
])('%s validity', (amount, from, until) => {
  const billing = { credits_available: 8, account_balance: 2, [amount]: 5, [from]: start, [until]: end };
  it('excludes future and exactly expired buckets without removing other regular/wallet funds', () => {
    expect(spendableCredits(billing, Date.parse(start) - 1)).toBe(5);
    expect(spendableCredits(billing, Date.parse(start))).toBe(10);
    expect(spendableCredits(billing, Date.parse(end) - 1)).toBe(10);
    expect(spendableCredits(billing, Date.parse(end))).toBe(5);
  });
  it.each([NaN, Infinity, '5', null, -1])('rejects malformed bucket %p', value => {
    expect(spendableCredits({ ...billing, [amount]: value }, Date.parse(start))).toBeNull();
  });
  it.each([undefined, null, 'invalid', 123])('rejects malformed positive-bucket dates %p', value => {
    expect(spendableCredits({ ...billing, [until]: value }, Date.parse(start))).toBeNull();
  });
  it('rejects buckets exceeding regular credits even if the wallet could cover them', () => {
    expect(spendableCredits({ ...billing, [amount]: 9 }, Date.parse(start))).toBeNull();
    expect(spendableCredits({ ...billing, [amount]: 9 }, Date.parse(end))).toBeNull();
  });
});

it('does not revive converted trial funds with a wallet top-up', () => {
  const billing = { credits_available: 5, account_balance: 2, trial_credits_available: 5,
    trial_started_at: start, trial_ends_at: end, trial_converted_at: start };
  expect(spendableCredits(billing, Date.parse(start))).toBe(2);
});

it('rejects combined classified buckets exceeding their aggregate', () => {
  expect(spendableCredits({ credits_available: 8, account_balance: 10,
    trial_credits_available: 5, trial_started_at: start, trial_ends_at: end,
    plan_credits_available: 5, plan_credit_period_start: start, plan_credit_period_end: end,
  }, Date.parse(start))).toBeNull();
});

it('does not reject decimal buckets because of binary projection roundoff', () => {
  const billing = { credits_available: .3, account_balance: 39.22,
    trial_credits_available: .1, trial_started_at: start, trial_ends_at: end,
    plan_credits_available: .2, plan_credit_period_start: start, plan_credit_period_end: end };
  expect(spendableCredits(billing, Date.parse(start))).toBe(39.52);
  expect(spendableCredits(billing, Date.parse(end))).toBe(39.22);
  expect(spendableCredits({ ...billing, account_balance: -.01 }, Date.parse(end))).toBe(-.01);
  expect(spendableCredits({ ...billing, credits_available: .299999 }, Date.parse(end))).toBeNull();
});

it('expires plan credits at an earlier paid coverage end without expiring wallet funds', () => {
  const billing = { credits_available: 8, account_balance: 2, plan_credits_available: 5,
    plan_credit_period_start: start, plan_credit_period_end: '2026-12-01T00:00:00Z', paid_subscription_period_end: end };
  expect(spendableCredits(billing, Date.parse(end) - 1)).toBe(10);
  expect(spendableCredits(billing, Date.parse(end))).toBe(5);
  expect(spendableCredits({ ...billing, paid_subscription_period_end: 'invalid' }, Date.parse(start))).toBeNull();
});