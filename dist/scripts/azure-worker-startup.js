#!/usr/bin/env node
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startupAzureWorker = main;
/**
 * Azure App Service worker entrypoint.
 * Starts a minimal HTTP health server (required by App Service) then runs
 * the same Temporal worker + schedule bootstrap as Render.
 */
const http_1 = __importDefault(require("http"));
const render_startup_1 = require("./render-startup");
const port = Number(process.env.PORT || process.env.WEBSITES_PORT || 8080);
function startHealthServer() {
    const server = http_1.default.createServer((req, res) => {
        if (req.url === '/health' || req.url === '/' || req.url === '/api/health') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                status: 'ok',
                service: 'temporal-worker',
                taskQueue: process.env.WORKFLOW_TASK_QUEUE || 'default',
                timestamp: new Date().toISOString(),
            }));
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
    await (0, render_startup_1.startupRender)();
}
if (require.main === module) {
    main().catch((err) => {
        console.error('Azure worker startup failed:', err);
        process.exit(1);
    });
}
