#!/usr/bin/env node
// Offline replay of exported Temporal histories. Does not contact Temporal or
// run Activities. Export histories from a trusted environment before deploy.
const fs = require('node:fs');
const path = require('node:path');
const { bundleWorkflowCode, DefaultLogger, Runtime, Worker } = require('@temporalio/worker');

async function main() {
  const files = process.argv.slice(2);
  if (!files.length) {
    console.error('Usage: node scripts/replay-lead-follow-up-histories.js <history.json> [...]');
    process.exitCode = 2;
    return;
  }

  Runtime.install({ logger: new DefaultLogger('ERROR') });
  try {
    const workflowBundle = await bundleWorkflowCode({
      workflowsPath: path.resolve(__dirname, '../src/temporal/workflows/worker-workflows.ts'),
      logger: new DefaultLogger('ERROR'),
    });

    for (const file of files) {
      const history = JSON.parse(fs.readFileSync(file, 'utf8'));
      // The CLI history export contains events, but not its workflow ID.
      // Supply the ID via a sibling .workflow-id text file when needed.
      const idFile = `${file}.workflow-id`;
      const workflowId = fs.existsSync(idFile) ? fs.readFileSync(idFile, 'utf8').trim() : undefined;
      try {
        await Worker.runReplayHistory({ workflowBundle }, history, workflowId);
        console.log(`Replay OK: ${path.basename(file)}`);
      } catch (error) {
        process.exitCode = 1;
        console.error(`Replay failed: ${path.basename(file)}: ${error.name}`);
      }
    }
  } finally {
    await Runtime.instance().shutdown();
  }
}

main().catch(error => {
  console.error(`Replay setup failed: ${error.name}`);
  process.exitCode = 1;
});