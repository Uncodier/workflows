import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test('production bundle exports every workflow registered for clients', () => {
  const directory = resolve(__dirname, '../src/temporal/workflows');
  const clientSource = readFileSync(resolve(directory, 'index.ts'), 'utf8');
  const workerSource = readFileSync(resolve(directory, 'worker-workflows.ts'), 'utf8');
  const exportedModules = (source: string) => [...source.matchAll(/export \* from ['"](.+)['"]/g)]
    .map(match => match[1]);
  const workerModules = new Set(exportedModules(workerSource));
  for (const module of exportedModules(clientSource)) {
    expect({ module, registered: workerModules.has(module) }).toEqual({ module, registered: true });
  }
});