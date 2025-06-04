"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TemporalToolExecutor = void 0;
const executeToolWorkflow_1 = require("../workflows/executeToolWorkflow");
class TemporalToolExecutor {
    client;
    constructor() {
        this.initClient();
    }
    async initClient() {
        const { Connection, Client } = require('@temporalio/client');
        const connectionOptions = {
            address: process.env.TEMPORAL_ADDRESS || 'localhost:7233',
        };
        // Add TLS configuration if needed
        if (process.env.TEMPORAL_TLS === 'true') {
            connectionOptions.tls = {};
        }
        if (process.env.TEMPORAL_API_KEY) {
            connectionOptions.metadata = {
                'temporal-namespace': process.env.TEMPORAL_NAMESPACE || 'default',
            };
            connectionOptions.apiKey = process.env.TEMPORAL_API_KEY;
        }
        const connection = await Connection.connect(connectionOptions);
        this.client = new Client({
            connection,
            namespace: process.env.TEMPORAL_NAMESPACE || 'default',
        });
    }
    async executeTool(input) {
        try {
            if (!this.client) {
                await this.initClient();
            }
            const handle = await this.client.workflow.start(executeToolWorkflow_1.executeToolWorkflow, {
                args: [input],
                taskQueue: 'execute-tool-queue',
                workflowId: `execute-tool-${input.toolName}-${Date.now()}`,
            });
            return await handle.result();
        }
        catch (error) {
            console.error(`[TemporalClient] Error executing tool ${input.toolName}:`, error);
            return {
                success: false,
                error: error.message || 'Temporal execution error',
            };
        }
    }
    async executeToolWithId(input, workflowId) {
        try {
            if (!this.client) {
                await this.initClient();
            }
            const handle = await this.client.workflow.start(executeToolWorkflow_1.executeToolWorkflow, {
                args: [input],
                taskQueue: 'execute-tool-queue',
                workflowId,
            });
            return await handle.result();
        }
        catch (error) {
            console.error(`[TemporalClient] Error executing tool ${input.toolName} with ID ${workflowId}:`, error);
            return {
                success: false,
                error: error.message || 'Temporal execution error',
            };
        }
    }
    async getWorkflowHandle(workflowId) {
        if (!this.client) {
            await this.initClient();
        }
        return this.client.workflow.getHandle(workflowId);
    }
    async cancelWorkflow(workflowId) {
        try {
            const handle = await this.getWorkflowHandle(workflowId);
            await handle.cancel();
            return true;
        }
        catch (error) {
            console.error(`[TemporalClient] Error canceling workflow ${workflowId}:`, error);
            return false;
        }
    }
}
exports.TemporalToolExecutor = TemporalToolExecutor;
