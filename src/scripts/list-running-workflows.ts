import { getTemporalClient } from '../temporal/client';

async function main() {
  const client = await getTemporalClient();
  console.log('Connected to Temporal...');
  
  try {
    const response = client.workflowService.listOpenWorkflowExecutions({
      namespace: process.env.TEMPORAL_NAMESPACE || 'default'
    });
    // Let's use the standard list API or we can just fetch all workflows using the client
    const workflows = client.workflow.list();
    let count = 0;
    for await (const wf of workflows) {
      if (wf.status.name === 'RUNNING') {
        console.log(`- ${wf.workflowId} (${wf.type})`);
        count++;
      }
    }
    console.log(`Total running workflows: ${count}`);
  } catch (err) {
    console.error('Error listing workflows:', err);
  }
}

main().catch(console.error);
