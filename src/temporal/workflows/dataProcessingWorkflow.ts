import { proxyActivities } from '@temporalio/workflow';
import type { Activities } from '../activities';

// Define the activity interface and options
const { 
  fetchDataActivity, 
  createResourceActivity, 
  updateResourceActivity, 
  // deleteResourceActivity,
  logWorkflowExecutionActivity,
  storeWorkflowResultActivity,
  fetchConfigurationActivity,
  // trackApiCallActivity,
} = proxyActivities<Activities>({
  startToCloseTimeout: '1 minute',
  retry: {
    maximumAttempts: 3,
  },
});

/**
 * Workflow to process data from an API
 * 
 * @param resourceId - ID of the resource to fetch and process
 * @param options - Optional processing options
 */
export async function dataProcessingWorkflow(
  resourceId: string,
  options: {
    transform?: boolean;
    storeResults?: boolean;
    notifyOnCompletion?: boolean;
  } = {}
): Promise<any> {
  // Log workflow execution start
  await logWorkflowExecutionActivity({
    workflowId: resourceId,
    workflowType: 'dataProcessingWorkflow',
    status: 'STARTED',
    input: { resourceId, options },
  });

  try {
    // Fetch configuration from Supabase if needed
    const config = await fetchConfigurationActivity('data_processing');
    
    // Fetch data from the API
    const fetchedData = await fetchDataActivity(resourceId);

    let processedData = fetchedData;

    // Apply transformations if needed
    if (options.transform) {
      processedData = {
        ...fetchedData,
        processed: true,
        processedAt: new Date().toISOString(),
        // Apply transformations based on config
        transformationConfig: config,
      };

      // Update the resource with processed data
      if (fetchedData.id) {
        await updateResourceActivity(fetchedData.id, processedData);
      } else {
        await createResourceActivity(processedData);
      }
    }

    // Store results in Supabase if requested
    if (options.storeResults) {
      await storeWorkflowResultActivity({
        workflowId: resourceId,
        result: processedData,
        metadata: {
          processedAt: new Date().toISOString(),
          transformApplied: options.transform,
        },
      });
    }

    // Log workflow execution completion
    await logWorkflowExecutionActivity({
      workflowId: resourceId,
      workflowType: 'dataProcessingWorkflow',
      status: 'COMPLETED',
      input: { resourceId, options },
      output: processedData,
    });

    return processedData;
  } catch (error: unknown) {
    // Log workflow execution failure
    await logWorkflowExecutionActivity({
      workflowId: resourceId,
      workflowType: 'dataProcessingWorkflow',
      status: 'FAILED',
      input: { resourceId, options },
      error: error instanceof Error ? error.message : String(error),
    });

    throw error;
  }
}



