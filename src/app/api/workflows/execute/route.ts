import { NextRequest, NextResponse } from 'next/server';
import { executeWorkflow } from '@/temporal/client';

export async function POST(req: NextRequest) {
  try {
    const { workflowType, workflowId, args } = await req.json();

    if (!workflowType || typeof workflowType !== 'string') {
      return NextResponse.json({ error: 'Invalid workflow type' }, { status: 400 });
    }

    const handle = await executeWorkflow(workflowType, args || [], workflowId);

    return NextResponse.json({
      message: 'Workflow started successfully',
      workflowId: handle.workflowId,
    });
  } catch (error) {
    console.error('Failed to execute workflow:', error);
    return NextResponse.json({ error: 'Failed to execute workflow' }, { status: 500 });
  }
}