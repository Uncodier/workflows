import { getTemporalClient } from '../../../../temporal/client';
import { NextRequest, NextResponse } from 'next/server';
import { WorkflowType, workflows } from '../../../../temporal/workflows';
import { temporalConfig } from '../../../../config/config';

export async function POST(req: NextRequest) {
  try {
    const { workflowType, workflowId, args } = await req.json();

    if (!workflowType || !Object.keys(workflows).includes(workflowType)) {
      return NextResponse.json({ error: 'Invalid workflow type' }, { status: 400 });
    }

    // Use the configured Temporal client
    const client = await getTemporalClient();

    // Start the workflow
    const handle = await client.workflow.start(workflows[workflowType as WorkflowType], {
      taskQueue: temporalConfig.taskQueue,
      workflowId: workflowId || `${workflowType}-${Date.now()}`,
      args: args || [],
    });

    return NextResponse.json({
      message: 'Workflow started successfully',
      workflowId: handle.workflowId,
    });
  } catch (error) {
    console.error('Failed to execute workflow:', error);
    return NextResponse.json({ error: 'Failed to execute workflow' }, { status: 500 });
  }
} 