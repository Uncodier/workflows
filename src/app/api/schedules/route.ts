import { NextRequest, NextResponse } from 'next/server';
import { getTemporalClient } from '@/temporal/client';
import { temporalConfig } from '@/config/config';
import { WorkflowType } from '@/temporal/workflows';

export async function GET() {
  try {
    const client = await getTemporalClient();
    const scheduleClient = client.schedule as any;
    const schedulesIterable = await scheduleClient.list();
    
    const schedules = [];
    for await (const schedule of schedulesIterable) {
      schedules.push({
        scheduleId: schedule.scheduleId
      });
    }
    
    return NextResponse.json({ schedules });
  } catch (error: unknown) {
    console.error('Error listing schedules:', error);
    return NextResponse.json(
      { error: `Failed to list schedules: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { scheduleId, workflowType, cronExpression, args } = body;

    if (!scheduleId || !workflowType || !cronExpression) {
      return NextResponse.json(
        { error: 'Missing required parameters: scheduleId, workflowType, and cronExpression' },
        { status: 400 }
      );
    }

    const client = await getTemporalClient();
    const scheduleClient = client.schedule as any;
    
    await scheduleClient.create({
      scheduleId,
      spec: {
        cron: cronExpression
      },
      action: {
        type: 'startWorkflow',
        workflowType: workflowType as WorkflowType,
        taskQueue: temporalConfig.taskQueue,
        args: args || [],
      },
      timeZone: 'UTC',
      policies: {
        catchupWindow: '5m',
        overlap: 'SKIP' as any,
        pauseOnFailure: false,
      },
    });

    return NextResponse.json({
      success: true,
      message: `Schedule ${scheduleId} created successfully`,
    });
  } catch (error: unknown) {
    console.error('Error creating schedule:', error);
    return NextResponse.json(
      { error: `Failed to create schedule: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const scheduleId = searchParams.get('scheduleId');

    if (!scheduleId) {
      return NextResponse.json(
        { error: 'Missing required parameter: scheduleId' },
        { status: 400 }
      );
    }

    const client = await getTemporalClient();
    const scheduleClient = client.schedule as any;
    await scheduleClient.delete(scheduleId);

    return NextResponse.json({
      success: true,
      message: `Schedule ${scheduleId} deleted successfully`,
    });
  } catch (error: unknown) {
    console.error('Error deleting schedule:', error);
    return NextResponse.json(
      { error: `Failed to delete schedule: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 }
    );
  }
} 