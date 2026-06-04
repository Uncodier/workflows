import { config } from 'dotenv';
config({ path: '.env.local' });
import { getTemporalClient } from './src/temporal/client';
import { temporalConfig } from './src/config/config';

async function main() {
  console.log('Temporal Config:', {
    serverUrl: temporalConfig.serverUrl,
    namespace: temporalConfig.namespace,
    tls: temporalConfig.tls,
    hasApiKey: !!temporalConfig.apiKey,
  });

  console.log('Connecting to Temporal...');
  const connectPromise = getTemporalClient();
  
  // Timeout for connection
  const client = await Promise.race([
    connectPromise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Connection timeout after 10s')), 10000))
  ]) as any;

  console.log('Connected!');
  const scheduleClient = client.schedule as any;

  console.log('=== Listing all schedules in Temporal ===\n');
  const schedulesIterable = await scheduleClient.list();
  const ids: string[] = [];
  for await (const s of schedulesIterable) {
    ids.push(s.scheduleId);
    console.log(`- ${s.scheduleId}`);
  }
  console.log(`\nTotal schedules: ${ids.length}\n`);

  const targetId = 'daily-credit-renewal';
  console.log(`=== Describing '${targetId}' ===\n`);

  if (!ids.includes(targetId)) {
    console.log(`❌ Schedule '${targetId}' DOES NOT EXIST in Temporal. This is why credits are not renewing.`);
    return;
  }

  try {
    const handle = scheduleClient.getHandle(targetId);
    const desc = await handle.describe();

    console.log('Paused:', desc.state?.paused);
    console.log('Note:', desc.state?.note);
    console.log('Action workflowType:', desc.action?.workflowType);
    console.log('Task Queue:', desc.action?.taskQueue);
    console.log('Spec intervals:', JSON.stringify(desc.spec?.intervals));
    console.log('Spec cron:', JSON.stringify(desc.spec?.cronExpressions));
    console.log('\n--- Info ---');
    console.log('Next action times:', desc.info?.nextActionTimes?.slice(0, 5));
    console.log('Recent actions count:', desc.info?.recentActions?.length);
    if (desc.info?.recentActions?.length) {
      console.log('Recent actions:');
      for (const a of desc.info.recentActions.slice(-5)) {
        console.log(`   scheduled=${a.scheduledAt?.toISOString?.() ?? a.scheduledAt} taken=${a.takenAt?.toISOString?.() ?? a.takenAt}`);
      }
    } else {
      console.log('⚠️ No recent actions recorded — the schedule has never fired or actions were lost.');
    }
    console.log('Running workflows:', desc.info?.runningActions?.length ?? 0);
  } catch (err) {
    console.error('Error describing schedule:', err);
  }
}

main().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});