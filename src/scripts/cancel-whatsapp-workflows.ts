import { getTemporalClient } from '../temporal/client';

async function main() {
  const client = await getTemporalClient();
  const siteId = '353b235b-1242-4e5e-9bfa-f0cf23363483';
  console.log(`Canceling whatsappMessageWorkflow for site ${siteId}...`);
  
  let canceledCount = 0;
  try {
    const workflows = client.workflow.list();
    for await (const wf of workflows) {
      if (wf.status.name === 'RUNNING' && wf.type === 'whatsappMessageWorkflow' && wf.workflowId.includes(siteId)) {
        console.log(`Canceling workflow ${wf.workflowId}...`);
        const handle = client.workflow.getHandle(wf.workflowId);
        await handle.cancel();
        canceledCount++;
      }
    }
    console.log(`✅ Canceled ${canceledCount} workflows.`);
  } catch (err) {
    console.error('Error canceling workflows:', err);
  }
}

main().catch(console.error);
