import {
  classifyIcpDispatchCooldown,
  IcpDispatchCandidate,
  IcpDispatchSelectionOptions,
  selectIcpDispatchCandidates,
} from '../src/temporal/utils/icpDispatchSelection';

const now = new Date('2026-10-01T12:00:00.000Z');
const yesterday = '2026-09-30T12:00:00.000Z';
const earlier = '2026-10-01T11:00:00.000Z';
const future = '2026-10-01T12:00:00.001Z';

function candidate(overrides: Partial<IcpDispatchCandidate> = {}): IcpDispatchCandidate {
  return {
    siteId: 'site-a',
    userId: 'user-a',
    icpId: 'list-a',
    remainingTargets: 100,
    hasCheckpoint: false,
    lastSiteDispatchAt: null,
    lastListDispatchAt: null,
    dailyFound: 0,
    dailyReservedMatches: 0,
    dailyCandidateReservations: 0,
    targetLeads: 100,
    active: false,
    ...overrides,
  };
}

function select<T extends IcpDispatchCandidate>(
  candidates: readonly T[],
  options: Partial<IcpDispatchSelectionOptions> = {},
): T[] {
  return selectIcpDispatchCandidates(candidates, { now, limit: 3, ...options });
}

function expectOrder(candidates: IcpDispatchCandidate[], expected: IcpDispatchCandidate[]): void {
  // Reversing input must not change the fair/deterministic order.
  expect(select(candidates, { limit: 100 })).toEqual(expected);
  expect(select([...candidates].reverse(), { limit: 100 })).toEqual(expected);
}

describe('selectIcpDispatchCandidates', () => {
  describe('fair ordering', () => {
    it('fills three slots across unequal sites rather than taking three lists of the giant', () => {
      const giant = candidate({ siteId: 'giant', icpId: 'giant-1', targetLeads: 3000, remainingTargets: 50000 });
      const giantSecond = { ...giant, icpId: 'giant-2' };
      const medium = candidate({ siteId: 'medium', icpId: 'medium-1', targetLeads: 200, remainingTargets: 400 });
      const small = candidate({ siteId: 'small', icpId: 'small-1', targetLeads: 10, remainingTargets: 20 });
      const input = [small, giantSecond, medium, giant, { ...giant, icpId: 'giant-3' }];

      expect(select(input)).toEqual([giant, medium, small]);
      expect(select(input, { limit: 2 })).toEqual([giant, medium]);
      expect(select([giant, giant, giantSecond])).toEqual([giant]);
    });

    it('prioritizes never-served then oldest sites over checkpoints, served ratio and load', () => {
      const never = candidate({ siteId: 'never', targetLeads: 10, dailyFound: 9 });
      const oldest = candidate({ siteId: 'oldest', lastSiteDispatchAt: yesterday, dailyFound: 90 });
      const recent = candidate({ siteId: 'recent', lastSiteDispatchAt: earlier, hasCheckpoint: true, targetLeads: 3000 });
      expectOrder([recent, oldest, never], [never, oldest, recent]);
    });

    it('prefers a resumable site before the served ratio when site timestamps tie', () => {
      const resumable = candidate({ siteId: 'z', hasCheckpoint: true, dailyFound: 99 });
      const fresh = candidate({ siteId: 'a', targetLeads: 3000, remainingTargets: 3000 });
      expectOrder([fresh, resumable], [resumable, fresh]);
    });

    it('compares daily found plus reserved matches divided by target, not absolute served counts', () => {
      const lowRatio = candidate({ siteId: 'z', targetLeads: 1000, dailyFound: 100, dailyReservedMatches: 100 });
      const highRatio = candidate({ siteId: 'a', targetLeads: 100, dailyFound: 10, dailyReservedMatches: 20 });
      expectOrder([highRatio, lowRatio], [lowRatio, highRatio]);
    });

    it('does not count candidate reservations as matched leads in the served ratio', () => {
      const lowRatio = candidate({ siteId: 'z', dailyCandidateReservations: 999 });
      const highRatio = candidate({ siteId: 'a', dailyFound: 1 });
      expectOrder([highRatio, lowRatio], [lowRatio, highRatio]);
    });

    it('breaks site ties by required load, bounded by remaining targets and daily matches', () => {
      const manyTargets = candidate({ siteId: 'a', remainingTargets: 10000, targetLeads: 10 });
      const largeDailyBudget = candidate({ siteId: 'b', remainingTargets: 5, targetLeads: 3000 });
      const largerLoad = candidate({ siteId: 'z', remainingTargets: 20, targetLeads: 100 });
      expectOrder([manyTargets, largeDailyBudget, largerLoad], [largerLoad, manyTargets, largeDailyBudget]);
    });

    it('breaks equivalent site ties lexically, independent of input order and locale', () => {
      const sites = ['site-z', 'site-2', 'site-10', 'site-A'].map(siteId => candidate({ siteId }));
      expectOrder(sites, [sites[2], sites[1], sites[3], sites[0]]);
    });

    it('compares dispatch instants rather than timestamp strings', () => {
      const older = candidate({ siteId: 'z', lastSiteDispatchAt: '2026-10-01T12:00:00+02:00' });
      const newer = candidate({ siteId: 'a', lastSiteDispatchAt: '2026-10-01T10:30:00Z' });
      expectOrder([newer, older], [older, newer]);
    });

    it('rotates to an unserved list rather than repeatedly choosing a recent checkpoint', () => {
      const fresh = candidate({ icpId: 'a', remainingTargets: 10000 });
      const resumable = candidate({ icpId: 'z', hasCheckpoint: true, remainingTargets: 1, lastListDispatchAt: earlier });
      expectOrder([fresh, resumable], [fresh]);
    });

    it.each([null, earlier])('prefers a checkpoint within a site before load when list ages tie at %s', lastListDispatchAt => {
      const fresh = candidate({ icpId: 'a', remainingTargets: 10000, lastListDispatchAt });
      const resumable = candidate({ icpId: 'z', hasCheckpoint: true, remainingTargets: 1, lastListDispatchAt });
      expectOrder([fresh, resumable], [resumable]);
    });

    it.each([false, true])('chooses the never-served then oldest list before load (checkpoint=%s)', hasCheckpoint => {
      const never = candidate({ icpId: 'z', hasCheckpoint, remainingTargets: 1 });
      const older = candidate({ icpId: 'b', hasCheckpoint, remainingTargets: 2, lastListDispatchAt: yesterday });
      const newer = candidate({ icpId: 'a', hasCheckpoint, remainingTargets: 1000, lastListDispatchAt: earlier });
      expectOrder([newer, older, never], [never]);
      expectOrder([newer, older], [older]);
    });

    it('breaks list age ties by larger required load, then lexical list id', () => {
      const small = candidate({ icpId: 'a', remainingTargets: 1 });
      const large = candidate({ icpId: 'z', remainingTargets: 90 });
      expectOrder([small, large], [large]);

      const dailyBounded = candidate({ icpId: 'b', remainingTargets: 10000 });
      const sameLoad = candidate({ icpId: 'a', remainingTargets: 100 });
      expectOrder([dailyBounded, sameLoad], [sameLoad]);
    });

    it('chooses each site list before ranking sites using that chosen list load', () => {
      const fresh = candidate({ siteId: 'a', icpId: 'fresh', remainingTargets: 100 });
      const chosen = candidate({ siteId: 'a', icpId: 'resumable', hasCheckpoint: true, remainingTargets: 5 });
      const other = candidate({ siteId: 'b', hasCheckpoint: true, remainingTargets: 10 });
      expectOrder([fresh, chosen, other], [other, chosen]);
    });

    it('gives every unequal site six of thirty slots and rotates lists over ten reservation rounds', () => {
      const targets = [3000, 700, 100, 30, 10];
      const listCounts = [6, 3, 2, 2, 2];
      let snapshot = targets.flatMap((targetLeads, siteIndex) => Array.from(
        { length: listCounts[siteIndex] }, (_, listIndex) => candidate({
          siteId: `site-${siteIndex}`,
          icpId: `list-${siteIndex}-${listIndex}`,
          targetLeads,
          remainingTargets: targetLeads * (listIndex + 1),
        }),
      ));
      const siteDispatches = new Map(targets.map((_, index) => [`site-${index}`, 0]));
      const listDispatches = new Map(snapshot.map(({ icpId }) => [icpId, 0]));

      for (let round = 0; round < 10; round++) {
        const roundTime = new Date(now.getTime() + round * 60000);
        const selected = select(snapshot, { now: roundTime });
        expect(selected).toHaveLength(3);
        expect(new Set(selected.map(({ siteId }) => siteId)).size).toBe(3);
        const chosenBySite = new Map(selected.map(item => [item.siteId, item.icpId]));
        const reservedAt = new Map(selected.map((item, index) => [
          item.siteId, new Date(roundTime.getTime() + index).toISOString(),
        ]));
        for (const { siteId, icpId } of selected) {
          siteDispatches.set(siteId, siteDispatches.get(siteId)! + 1);
          listDispatches.set(icpId, listDispatches.get(icpId)! + 1);
        }

        // Simulate the DB reservation, not mutation by the selection helper:
        // every list sees the shared site timestamp/budget, only the chosen list
        // gets a new list timestamp and consumes one of its remaining targets.
        // Separate reservation calls persist distinct timestamps in dispatch order.
        snapshot = snapshot.map(item => chosenBySite.has(item.siteId) ? {
          ...item,
          lastSiteDispatchAt: reservedAt.get(item.siteId)!,
          dailyReservedMatches: item.dailyReservedMatches + 1,
          dailyCandidateReservations: item.dailyCandidateReservations + 1,
          ...(chosenBySite.get(item.siteId) === item.icpId ? {
            lastListDispatchAt: reservedAt.get(item.siteId)!,
            remainingTargets: item.remainingTargets! - 1,
          } : {}),
        } : item);
        const counts = [...siteDispatches.values()];
        expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
      }

      expect([...siteDispatches.values()]).toEqual([6, 6, 6, 6, 6]);
      for (const item of snapshot) {
        const siteIndex = Number(item.siteId.slice('site-'.length));
        expect(listDispatches.get(item.icpId)).toBe(6 / listCounts[siteIndex]);
      }
    });

    it('does not starve smaller sites over ten rounds even when batch reservation timestamps tie', () => {
      let snapshot = [3000, 700, 100, 30, 10].map((targetLeads, index) => candidate({
        siteId: `site-${index}`, targetLeads, remainingTargets: null,
      }));
      const dispatchCounts = new Map(snapshot.map(item => [item.siteId, 0]));
      let previousSites = new Set<string>();
      for (let round = 0; round < 10; round++) {
        const roundTime = new Date(now.getTime() + round * 60000);
        const selected = select(snapshot, { now: roundTime });
        expect(selected).toHaveLength(3);
        const sites = new Set(selected.map(item => item.siteId));
        if (round > 0) {
          // With five eligible sites and three slots, every site is served within
          // two consecutive rounds. Tied timestamps may give extra slots to the
          // least satisfied site, so equal totals are not required by this rule.
          expect(new Set([...previousSites, ...sites]).size).toBe(5);
        }
        for (const { siteId } of selected) {
          dispatchCounts.set(siteId, dispatchCounts.get(siteId)! + 1);
        }
        snapshot = snapshot.map(item => sites.has(item.siteId) ? {
          ...item,
          lastSiteDispatchAt: roundTime.toISOString(),
          lastListDispatchAt: roundTime.toISOString(),
          dailyReservedMatches: item.dailyReservedMatches + 1,
          dailyCandidateReservations: item.dailyCandidateReservations + 1,
        } : item);
        previousSites = sites;
      }
      expect([...dispatchCounts.values()].reduce((sum, count) => sum + count, 0)).toBe(30);
      for (const count of dispatchCounts.values()) expect(count).toBeGreaterThanOrEqual(5);
    });

    it('rotates five times each over ten rounds between a persistent checkpoint and a fresh list', () => {
      let snapshot = [
        candidate({ icpId: 'fresh', remainingTargets: 10000 }),
        candidate({ icpId: 'checkpoint', hasCheckpoint: true, remainingTargets: null }),
      ];
      const selectedIds: string[] = [];
      for (let round = 0; round < 10; round++) {
        const roundTime = new Date(now.getTime() + round * 300000);
        const [selected] = select(snapshot, { now: roundTime });
        selectedIds.push(selected.icpId);
        snapshot = snapshot.map(item => ({
          ...item,
          lastSiteDispatchAt: roundTime.toISOString(),
          ...(item.icpId === selected.icpId ? {
            lastListDispatchAt: roundTime.toISOString(),
            listNextEligibleAt: new Date(roundTime.getTime() + 300000).toISOString(),
          } : {}),
        }));
      }
      expect(selectedIds).toEqual(Array.from({ length: 10 }, (_, index) => index % 2 ? 'fresh' : 'checkpoint'));
    });
  });

  describe('eligibility and quota boundaries', () => {
    it('accepts ordinary nonempty string identifiers, not only UUIDs', () => {
      const item = candidate({ siteId: 'My site', userId: 'owner', icpId: 'prospect-list' });
      expect(select([item])).toEqual([item]);
    });

    it.each(['siteId', 'userId', 'icpId'] as const)('rejects empty or nonstring %s', field => {
      for (const value of ['', '  \t', null, undefined, 42]) {
        expect(select([candidate({ [field]: value } as Partial<IcpDispatchCandidate>)])).toEqual([]);
      }
    });

    it.each([0, -1, 3001, 1.5, NaN, Infinity, -Infinity])('rejects invalid targetLeads %s', targetLeads => {
      expect(select([candidate({ targetLeads })])).toEqual([]);
    });

    it.each([1, 3000])('accepts inclusive targetLeads boundary %s', targetLeads => {
      expect(select([candidate({ targetLeads })])).toHaveLength(1);
    });

    it.each([
      { dailyFound: 100 },
      { dailyFound: 101 },
      { dailyReservedMatches: 100 },
      { dailyFound: 60, dailyReservedMatches: 40 },
      { dailyFound: 60, dailyReservedMatches: 41 },
    ])('excludes a site with no daily match quota: %j', exhausted => {
      expect(select([candidate({ ...exhausted, hasCheckpoint: true })])).toEqual([]);
    });

    it('accepts exactly one remaining daily match without reserving it', () => {
      const item = candidate({ dailyFound: 50, dailyReservedMatches: 49 });
      expect(select([item])).toEqual([item]);
      expect(item.dailyReservedMatches).toBe(49);
    });

    it.each([
      { targetLeads: 10, cap: 100, configured: undefined },
      { targetLeads: 3000, cap: 3000, configured: undefined },
      { targetLeads: 100, cap: 40, configured: 40 },
      { targetLeads: 10, cap: 100, configured: 4000 },
      { targetLeads: 3000, cap: 4000, configured: 4000 },
    ])('requires candidate quota below min(configured limit, target * 10): %j', ({ targetLeads, cap, configured }) => {
      for (const reservations of [cap, cap + 1]) {
        expect(select([candidate({ targetLeads, dailyCandidateReservations: reservations })], {
          dailyCandidateLimit: configured,
        })).toEqual([]);
      }
      expect(select([candidate({ targetLeads, dailyCandidateReservations: cap - 1 })], {
        dailyCandidateLimit: configured,
      })).toHaveLength(1);
    });

    it.each([false, true])('excludes known exhausted lists even with checkpoint=%s', hasCheckpoint => {
      for (const remainingTargets of [0, -1, -100]) {
        expect(select([candidate({ hasCheckpoint, remainingTargets })])).toEqual([]);
      }
    });

    it.each([false, true])('allows unknown remaining targets with checkpoint=%s, bounded by daily quota', hasCheckpoint => {
      const unknown = candidate({ siteId: 'z', hasCheckpoint, remainingTargets: null });
      const finite = candidate({ siteId: 'a', hasCheckpoint, remainingTargets: 99 });
      expectOrder([finite, unknown], [unknown, finite]);
      expect(select([{ ...unknown, dailyFound: 100 }])).toEqual([]);
      expect(select([{ ...unknown, dailyCandidateReservations: 1000 }])).toEqual([]);
    });

    it.each(['dailyFound', 'dailyReservedMatches', 'dailyCandidateReservations', 'remainingTargets'] as const)(
      'fails closed for malformed %s counts', field => {
        for (const value of [-1, 0.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, undefined, '10']) {
          expect(select([candidate({ [field]: value } as Partial<IcpDispatchCandidate>)])).toEqual([]);
        }
        if (field !== 'remainingTargets') {
          expect(select([candidate({ [field]: null } as Partial<IcpDispatchCandidate>)])).toEqual([]);
        }
      },
    );

    it('excludes active dispatch sites and their checkpoint lists', () => {
      const available = candidate({ siteId: 'available' });
      expect(select([
        candidate({ active: true }),
        candidate({ active: true, icpId: 'checkpoint', hasCheckpoint: true }),
        available,
      ])).toEqual([available]);
    });

    it.each(['nextEligibleAt', 'listNextEligibleAt'] as const)('requires %s to be absent or elapsed', field => {
      for (const value of [undefined, null, yesterday, now.toISOString(), '2026-10-01T14:00:00+02:00']) {
        expect(select([candidate({ [field]: value })])).toHaveLength(1);
      }
      for (const value of [future, '2099-01-01T00:00:00Z', '', 'not-a-date', '2099-99-99T00:00:00Z']) {
        expect(select([candidate({ [field]: value, hasCheckpoint: true })])).toEqual([]);
      }
    });

    it('checks both cooldowns independently and can fall back to another eligible list of the same site', () => {
      const available = candidate({ icpId: 'fresh' });
      expect(select([
        candidate({ icpId: 'checkpoint', hasCheckpoint: true, listNextEligibleAt: future, nextEligibleAt: yesterday }),
        available,
      ])).toEqual([available]);
      expect(select([candidate({ nextEligibleAt: future, listNextEligibleAt: yesterday })])).toEqual([]);
      expect(select([candidate({ nextEligibleAt: 'malformed', listNextEligibleAt: yesterday })])).toEqual([]);
    });

    it.each(['lastSiteDispatchAt', 'lastListDispatchAt'] as const)('does not treat invalid %s as never dispatched', field => {
      for (const value of ['', 'not-a-date']) {
        expect(select([candidate({ [field]: value })])).toEqual([]);
      }
    });

    it.each([0, -1, 1.5, NaN, Infinity])('returns no work for invalid/zero slot limit %s', limit => {
      expect(select([candidate()], { limit })).toEqual([]);
    });

    it.each([0, -1, 1.5, NaN, Infinity])('returns no work for invalid/zero candidate limit %s', dailyCandidateLimit => {
      expect(select([candidate()], { dailyCandidateLimit })).toEqual([]);
    });

    it('returns no work for invalid now, empty input or wholly ineligible input', () => {
      expect(select([candidate()], { now: new Date(NaN) })).toEqual([]);
      expect(select([])).toEqual([]);
      expect(select([candidate({ active: true }), candidate({ remainingTargets: 0 })])).toEqual([]);
    });
  });

  describe('pure planner boundary', () => {
    it('never mutates arrays, options, timestamps, quotas or opaque list payloads', () => {
      const low = Object.freeze({ ...candidate({ siteId: 'z', dailyFound: 50 }), payload: Object.freeze({ selectedListId: 'external' }) });
      const high = Object.freeze({ ...candidate({ siteId: 'a' }), payload: Object.freeze({ selectedListId: 'external' }) });
      const input = Object.freeze([low, high]);
      const options = Object.freeze({ now, limit: 2 });
      const before = JSON.stringify({ input, options });

      const result = selectIcpDispatchCandidates(input, options);
      expect(result).toEqual([high, low]);
      expect(result).not.toBe(input);
      expect(result[0]).toBe(high);
      expect(result[0].payload).toBe(high.payload);
      expect(JSON.stringify({ input, options })).toBe(before);
      expect(selectIcpDispatchCandidates(input, options)).toEqual(result);
    });

    it('only ranks supplied lists; resolving a selected-list setting belongs to the caller', () => {
      const supplied = { ...candidate({ icpId: 'caller-scoped-list' }), selectedListId: 'not-supplied' };
      const result = select([supplied]);
      expect(result).toEqual([supplied]);
      expect(result[0].selectedListId).toBe('not-supplied');
      expect(result.some(item => item.icpId === 'not-supplied')).toBe(false);
    });

    it('uses only options.now rather than consulting the wall clock', () => {
      const dateNow = jest.spyOn(Date, 'now').mockImplementation(() => { throw new Error('Unexpected wall clock'); });
      try {
        expect(select([candidate({ nextEligibleAt: earlier })])).toHaveLength(1);
      } finally {
        dateNow.mockRestore();
      }
    });
  });
});

describe('classifyIcpDispatchCooldown', () => {
  it.each([
    { errors: [] },
    { errors: [''] },
    { errors: ['Unexpected provider failure'] },
    { errors: ['HTTP 429 Too Many Requests'] },
    { errors: ['TEMPORARILY_PENDING'] },
    { errors: ['PENDING'] },
    { errors: ['Request timed out', 'HTTP 503'] },
    { errors: ['Unknown organization'] },
    { errors: ['candidate 1402 failed'] },
    { errors: ['Failed to read credit renewal history'] },
  ])('uses a 300-second base for ordinary or temporary errors: %j', ({ errors }) => {
    expect(classifyIcpDispatchCooldown(errors)).toBe(300);
  });

  it.each([
    'HTTP 402 Payment Required',
    'http402',
    'INSUFFICIENT_FUNDS',
    'insufficientFunds',
    'Insufficient credits to run search',
    'INSUFFICIENT_CREDITS',
    'Not enough credits',
    'No credits remaining',
    'Out of credits',
    'Credit balance exhausted',
    'SUBMISSION_UNKNOWN',
    'submissionUnknown',
    'Unknown submission',
    'Submission outcome is unknown',
    'Ambiguous initial submission',
  ])('uses six hours for credit or reconciliation failures: %s', error => {
    expect(classifyIcpDispatchCooldown([error])).toBe(21600);
  });

  it.each(['Ambiguous organization identity: ACME', 'AMBIGUOUS_ORG',
    'Organization identity is ambiguous', 'Cannot resolve organization identity: ACME'])
  ('does not assign a cooldown for identity review: %s', error => {
    expect(classifyIcpDispatchCooldown([error], 21)).toBe(0);
  });

  it('retains backoff for a real transient or credit failure alongside a review', () => {
    expect(classifyIcpDispatchCooldown(['Ambiguous organization identity: ACME', 'HTTP 503'])).toBe(300);
    expect(classifyIcpDispatchCooldown(['AMBIGUOUS_ORG', 'INSUFFICIENT_FUNDS'])).toBe(21600);
  });

  it('chooses the longest base across errors without modifying the array', () => {
    const errors = Object.freeze(['HTTP 429', 'INSUFFICIENT_FUNDS', 'PENDING']);
    expect(classifyIcpDispatchCooldown(errors)).toBe(21600);
    expect(classifyIcpDispatchCooldown([...errors].reverse())).toBe(21600);
    expect(errors).toEqual(['HTTP 429', 'INSUFFICIENT_FUNDS', 'PENDING']);
  });

  it.each([undefined, 0, 1, 2, 7, 100])('leaves exponential backoff to SQL/API, failure count %s', failures => {
    expect(classifyIcpDispatchCooldown(['HTTP 429'], failures)).toBe(300);
    expect(classifyIcpDispatchCooldown(['INSUFFICIENT_FUNDS'], failures)).toBe(21600);
  });
});