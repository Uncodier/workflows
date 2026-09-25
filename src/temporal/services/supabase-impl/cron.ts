import { SupabaseClient } from '@supabase/supabase-js';

export async function fetchCronStatus(client: SupabaseClient, activityName: string, siteIds: string[]): Promise<any[]> {
  console.log(`🔍 Fetching cron status for activity '${activityName}' and ${siteIds.length} sites...`);
  const { data, error } = await client
    .from('cron_status')
    .select('*')
    .eq('activity_name', activityName)
    .in('site_id', siteIds);

  if (error) {
    console.error('❌ Error fetching cron status:', error);
    throw new Error(`Failed to fetch cron status: ${error.message}`);
  }

  console.log(`✅ Successfully fetched ${data?.length || 0} cron status records from database`);
  return data || [];
}

export async function upsertCronStatus(client: SupabaseClient, cronStatusRecord: any): Promise<void> {
  console.log(`🔍 Upserting cron status for site ${cronStatusRecord.site_id}...`);
  await batchUpsertCronStatus(client, [cronStatusRecord]);
}

export async function batchUpsertCronStatus(client: SupabaseClient, records: any[]): Promise<void> {
  if (records.length === 0) return;

  console.log(`📝 Batch upserting ${records.length} cron status records...`);
  const updatedAt = new Date().toISOString();
  const normalizedRecords = records.map((record) => ({
    ...record,
    status: typeof record.status === 'string'
      ? record.status.toUpperCase()
      : record.status,
    updated_at: updatedAt,
  }));

  const { error } = await client
    .from('cron_status')
    .upsert(normalizedRecords, {
      onConflict: 'site_id,activity_name',
      ignoreDuplicates: false,
    });

  if (error) {
    console.error('❌ Error batch upserting cron status:', error);
    throw new Error(`Failed to batch upsert cron status: ${error.message}`);
  }

  console.log(`✅ Successfully processed ${records.length} cron status records`);
}

export async function fetchStuckCronStatus(client: SupabaseClient, hoursThreshold: number = 2): Promise<any[]> {
  console.log(`🔍 Fetching stuck RUNNING cron status records older than ${hoursThreshold} hours...`);
  const thresholdTime = new Date(Date.now() - hoursThreshold * 60 * 60 * 1000).toISOString();
  
  const { data, error } = await client
    .from('cron_status')
    .select('*')
    .eq('status', 'RUNNING')
    .lt('updated_at', thresholdTime)
    .order('updated_at', { ascending: false });

  if (error) {
    console.error('❌ Error fetching stuck cron status records:', error);
    throw new Error(`Failed to fetch stuck cron status: ${error.message}`);
  }

  console.log(`✅ Found ${data?.length || 0} stuck RUNNING records`);
  return data || [];
}

export async function fetchAllRunningCronStatus(client: SupabaseClient): Promise<any[]> {
  console.log('🔍 Fetching all RUNNING cron status records...');
  
  const { data, error } = await client
    .from('cron_status')
    .select('*')
    .eq('status', 'RUNNING')
    .order('updated_at', { ascending: false });

  if (error) {
    console.error('❌ Error fetching running cron status records:', error);
    throw new Error(`Failed to fetch running cron status: ${error.message}`);
  }

  console.log(`✅ Found ${data?.length || 0} RUNNING records`);
  return data || [];
}

export async function resetCronStatusToFailed(client: SupabaseClient, recordId: string, errorMessage: string): Promise<void> {
  console.log(`📝 Resetting cron status record ${recordId} to FAILED...`);
  
  const { error } = await client
    .from('cron_status')
    .update({
      status: 'FAILED',
      error_message: errorMessage,
      updated_at: new Date().toISOString()
    })
    .eq('id', recordId);

  if (error) {
    console.error('❌ Error resetting cron status:', error);
    throw new Error(`Failed to reset cron status: ${error.message}`);
  }

  console.log('✅ Successfully reset cron status record to FAILED');
}

export async function fetchRecentCronStatus(client: SupabaseClient, limit: number = 10): Promise<any[]> {
  console.log(`🔍 Fetching ${limit} most recent cron status records...`);
  
  const { data, error } = await client
    .from('cron_status')
    .select(`
      id,
      workflow_id,
      schedule_id,
      activity_name,
      status,
      created_at,
      updated_at
    `)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('❌ Error fetching recent cron status records:', error);
    throw new Error(`Failed to fetch recent cron status: ${error.message}`);
  }

  console.log(`✅ Found ${data?.length || 0} recent records`);
  return data || [];
}



