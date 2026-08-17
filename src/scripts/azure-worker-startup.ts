#!/usr/bin/env node
/**
 * Azure App Service worker entrypoint.
 * Starts a minimal HTTP health server (required by App Service) then runs
 * the same Temporal worker + schedule bootstrap as Render.
 */
import http from 'http';
import { startupRender } from './render-startup';

const port = Number(process.env.PORT || process.env.WEBSITES_PORT || 8080);

function startHealthServer(): http.Server {
  const server = http.createServer((req, res) => {
    if (req.url === '/health' || req.url === '/' || req.url === '/api/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          status: 'ok',
          service: 'temporal-worker',
          taskQueue: process.env.WORKFLOW_TASK_QUEUE || 'default',
          timestamp: new Date().toISOString(),
        })
      );
      return;
    }
    res.writeHead(404);
    res.end();
  });

  server.listen(port, () => {
    console.log(`Azure health server listening on :${port}`);
  });

  return server;
}

async function main() {
  console.log('AZURE WORKER STARTUP');
  console.log(`Task queue: ${process.env.WORKFLOW_TASK_QUEUE || 'default'}`);
  startHealthServer();
  await startupRender();
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Azure worker startup failed:', err);
    process.exit(1);
  });
}

export { main as startupAzureWorker };
