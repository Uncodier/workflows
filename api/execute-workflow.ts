import { Connection, Client } from '@temporalio/client';
import { temporalConfig } from '../src/config/config';
import type { NextApiRequest, NextApiResponse } from 'next';
import { WorkflowType, workflows } from '../src/temporal/workflows';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { workflowType, workflowId, args } = req.body;

    if (!workflowType || !Object.keys(workflows).includes(workflowType)) {
      return res.status(400).json({ error: 'Invalid workflow type' });
    }

    // Connect to Temporal server
    const connection = await Connection.connect({
      address: temporalConfig.serverUrl,
    });

    const client = new Client({
      connection,
      namespace: temporalConfig.namespace,
    });

    // Start the workflow
    const handle = await client.workflow.start(workflows[workflowType as WorkflowType], {
      taskQueue: temporalConfig.taskQueue,
      workflowId: workflowId || `${workflowType}-${Date.now()}`,
      args: args || [],
    });

    res.status(200).json({
      message: 'Workflow started successfully',
      workflowId: handle.workflowId,
    });
  } catch (error) {
    console.error('Failed to execute workflow:', error);
    res.status(500).json({ error: 'Failed to execute workflow' });
  }
} 