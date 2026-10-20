import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Read source only: never import production worker/config (which would load dotenv/connect).
const source = (path: string) => readFileSync(resolve(__dirname, '../src', path), 'utf8');

test('registers catalog activities in the bundle consumed by the actual production worker', () => {
  const worker = source('temporal/workers/worker.ts');
  const activities = source('temporal/activities/index.ts');
  expect(worker).toContain("import { activities } from '../activities'");
  expect(worker).toMatch(/workflowsPath:\s*require.resolve\('\.\.\/workflows\/worker-workflows'\)/);
  expect(worker).toMatch(/\n\s+activities,/);
  expect(activities).toContain("export * from './catalogIndexActivities'");
  expect(activities).toContain("import * as catalogIndexActivities from './catalogIndexActivities'");
  expect(activities).toMatch(/export const activities = \{[\s\S]*\.\.\.catalogIndexActivities,/);
  expect(source('temporal/workflows/worker-workflows.ts')).toContain("export * from './catalogIndexWorkflow'");
});

test('exports workflow for clients, name registry and the shared existing default task queue', () => {
  const workflows = source('temporal/workflows/index.ts');
  expect(workflows).toContain("import { catalogIndexWorkflow } from './catalogIndexWorkflow'");
  expect(workflows).toContain("export * from './catalogIndexWorkflow'");
  expect(workflows).toMatch(/export const workflows = \{[\s\S]*\n\s+catalogIndexWorkflow,/);
  expect(workflows).toContain("catalogIndexWorkflow: 'catalogIndexWorkflow'");
  expect(source('config/config.ts')).toContain("taskQueue: process.env.WORKFLOW_TASK_QUEUE || 'default'");
});

test('workflow module has no runtime activity, API, environment or database imports', () => {
  const workflow = source('temporal/workflows/catalogIndexWorkflow.ts');
  expect(workflow).toContain("import type * as activities from '../activities/catalogIndexActivities'");
  expect(workflow).not.toMatch(/process\.env|fetch\(|supabase|apiService|Promise\.all/);
});