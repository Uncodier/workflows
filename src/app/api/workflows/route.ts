import { NextRequest, NextResponse } from 'next/server';
import { executeWorkflow } from '@/temporal/client';
import { WorkflowType } from '@/temporal/workflows';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { workflowType, resourceId, options } = body;

    if (!workflowType || !resourceId) {
      return NextResponse.json(
        { error: 'Missing required parameters: workflowType and resourceId' },
        { status: 400 }
      );
    }

    const handle = await executeWorkflow(workflowType as WorkflowType, [resourceId, options || {}]);

    return NextResponse.json({
      success: true,
      message: `Workflow ${workflowType} started successfully`,
      workflowId: handle.workflowId,
    });
  } catch (error: unknown) {
    console.error('Error executing workflow:', error);
    return NextResponse.json(
      { error: `Failed to execute workflow: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    message: 'Use POST to execute a workflow',
    example: {
      workflowType: 'dataProcessingWorkflow',
      resourceId: 'resource-123',
      options: {
        transform: true,
        storeResults: true,
      },
    },
  });
} 