import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

it('registers only the independent ICP admission workflow every five minutes', () => {
  const file = resolve(__dirname, '../src/temporal/schedules/index.ts');
  const output = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} as any };
  const requireStub = (name: string) => {
    if (name === '../../config/config') return { temporalConfig: { taskQueue: 'default' } };
    if (name === '../workflows') return { workflowNames: {} };
    if (name === './connection') return {};
    throw new Error(`Unexpected import ${name}`);
  };
  new Function('require', 'module', 'exports', output)(requireStub, module, module.exports);
  const schedules = module.exports.defaultSchedules;
  expect(schedules.filter((s: any) => s.id === 'icp-dispatcher')).toEqual([expect.objectContaining({
    workflowType: 'icpDispatcherWorkflow', intervalMinutes: 5, jitterMs: 15000,
    overlap: 'SKIP', catchupWindow: '5m', paused: false, pauseOnFailure: false,
  })]);
  expect(schedules.find((s: any) => s.id === 'central-schedule-activities').intervalMinutes).toBe(1440);
  expect(readFileSync(resolve(__dirname, '../src/temporal/workflows/worker-workflows.ts'), 'utf8'))
    .toContain("export * from './icpMiningSliceWorkflow'");
});