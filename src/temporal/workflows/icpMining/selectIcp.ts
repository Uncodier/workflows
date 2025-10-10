export function selectNextIcp(items: any[]): any {
  if (!Array.isArray(items) || items.length === 0) return undefined;

  const computeRemaining = (it: any): number => {
    const total = typeof it?.total_targets === 'number' ? it.total_targets : undefined;
    const processed = typeof it?.processed_targets === 'number' ? it.processed_targets : 0;
    if (typeof total === 'number' && total >= 0) {
      const rem = total - processed;
      return rem > 0 ? rem : 0;
    }
    // Unknown total: prioritize to hydrate early
    return Number.MAX_SAFE_INTEGER;
  };

  const byPriority = items
    .slice()
    .sort((a, b) => {
      const aRunning = a.status === 'running' ? 1 : 0;
      const bRunning = b.status === 'running' ? 1 : 0;
      if (aRunning !== bRunning) return bRunning - aRunning;
      const remA = computeRemaining(a);
      const remB = computeRemaining(b);
      return remB - remA;
    });

  return byPriority[0];
}


