import { executeToolWorkflow } from '../workflows/executeToolWorkflow';
import type { ExecuteToolInput, ExecuteToolResult } from '../workflows/executeToolWorkflow';

export class TemporalToolExecutor {
  private client: any;
  
  constructor() {
    this.initClient();
  }
  
  private async initClient() {
    const { Connection, Client } = require('@temporalio/client');
    
    const connectionOptions: any = {
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
  
  async executeTool(input: ExecuteToolInput): Promise<ExecuteToolResult> {
    try {
      if (!this.client) {
        await this.initClient();
      }
      
      const handle = await this.client.workflow.start(executeToolWorkflow, {
        args: [input],
        taskQueue: 'execute-tool-queue',
        workflowId: `execute-tool-${input.toolName}-${Date.now()}`,
      });
      
      return await handle.result();
    } catch (error: any) {
      console.error(`[TemporalClient] Error executing tool ${input.toolName}:`, error);
      return {
        success: false,
        error: error.message || 'Temporal execution error',
      };
    }
  }
  
  async executeToolWithId(input: ExecuteToolInput, workflowId: string): Promise<ExecuteToolResult> {
    try {
      if (!this.client) {
        await this.initClient();
      }
      
      const handle = await this.client.workflow.start(executeToolWorkflow, {
        args: [input],
        taskQueue: 'execute-tool-queue',
        workflowId,
      });
      
      return await handle.result();
    } catch (error: any) {
      console.error(`[TemporalClient] Error executing tool ${input.toolName} with ID ${workflowId}:`, error);
      return {
        success: false,
        error: error.message || 'Temporal execution error',
      };
    }
  }
  
  async getWorkflowHandle(workflowId: string) {
    if (!this.client) {
      await this.initClient();
    }
    return this.client.workflow.getHandle(workflowId);
  }
  
  async cancelWorkflow(workflowId: string): Promise<boolean> {
    try {
      const handle = await this.getWorkflowHandle(workflowId);
      await handle.cancel();
      return true;
    } catch (error: any) {
      console.error(`[TemporalClient] Error canceling workflow ${workflowId}:`, error);
      return false;
    }
  }
} 