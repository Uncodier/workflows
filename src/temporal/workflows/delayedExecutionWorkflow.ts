import { executeChild, sleep } from '@temporalio/workflow';

export interface DelayedExecutionOptions {
  delayMs: number;
  targetWorkflow: string;
  targetArgs: any[];
  siteName?: string;
  scheduledTime?: string;
  executionType?: string;
}

/**
 * Delayed Execution Workflow
 * Waits for a specified delay and then executes the target workflow
 * Used for timer-based scheduling instead of cron schedules
 */
export async function delayedExecutionWorkflow(
  options: DelayedExecutionOptions
): Promise<{
  success: boolean;
  delayedFor: string;
  targetWorkflow: string;
  targetResult?: any;
  error?: string;
}> {
  const { delayMs, targetWorkflow, targetArgs, siteName, scheduledTime, executionType } = options;
  
  console.log(`⏰ Starting delayed execution workflow`);
  console.log(`   - Target workflow: ${targetWorkflow}`);
  console.log(`   - Site: ${siteName || 'Unknown'}`);
  console.log(`   - Scheduled time: ${scheduledTime || 'Unknown'}`);
  console.log(`   - Execution type: ${executionType || 'timer-based'}`);
  console.log(`   - Delay: ${delayMs}ms (${(delayMs / 1000 / 60).toFixed(1)} minutes)`);

  try {
    // If delay is positive, sleep first
    if (delayMs > 0) {
      console.log(`😴 Sleeping for ${delayMs}ms...`);
      await sleep(delayMs);
      console.log(`⏰ Delay complete! Now executing ${targetWorkflow}`);
    } else {
      console.log(`⚡ No delay needed, executing ${targetWorkflow} immediately`);
    }

    // Execute the target workflow
    console.log(`🚀 Starting ${targetWorkflow} for ${siteName || 'site'}`);
    
    const targetResult = await executeChild(targetWorkflow, {
      workflowId: `${targetWorkflow}-executed-${Date.now()}`,
      args: targetArgs,
    });

    console.log(`✅ Successfully executed ${targetWorkflow} for ${siteName || 'site'}`);
    
    return {
      success: true,
      delayedFor: `${(delayMs / 1000 / 60).toFixed(1)} minutes`,
      targetWorkflow,
      targetResult
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Failed to execute delayed workflow ${targetWorkflow}: ${errorMessage}`);
    
    return {
      success: false,
      delayedFor: `${(delayMs / 1000 / 60).toFixed(1)} minutes`,
      targetWorkflow,
      error: errorMessage
    };
  }
} 