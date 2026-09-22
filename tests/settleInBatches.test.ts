import { settleInBatches } from '../src/temporal/workflows/helpers/settleInBatches';

describe('settleInBatches', () => {
  it('does not start the next batch until every active task settles', async () => {
    const releases: Array<() => void> = [];
    const started: number[] = [];
    let reportThirdStarted!: () => void;
    const thirdStarted = new Promise<void>((resolve) => {
      reportThirdStarted = resolve;
    });
    const run = settleInBatches([1, 2, 3], 2, async (item) => {
      started.push(item);
      if (item === 3) reportThirdStarted();
      await new Promise<void>((resolve) => releases.push(resolve));
      return item;
    });

    await Promise.resolve();
    expect(started).toEqual([1, 2]);

    releases[0]();
    await Promise.resolve();
    expect(started).toEqual([1, 2]);

    releases[1]();
    await thirdStarted;
    expect(started).toEqual([1, 2, 3]);

    releases[2]();
    await expect(run).resolves.toHaveLength(3);
  });
});
