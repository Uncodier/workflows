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

  // Try to find existing record
  const { data: existingRecord, error: selectError } = await client
    .from('cron_status')
    .select('id')
    .eq('site_id', cronStatusRecord.site_id)
    .eq('activity_name', cronStatusRecord.activity_name)
    .single();

  if (selectError && selectError.code !== 'PGRST116') { // PGRST116 = no rows returned
    console.error('❌ Error checking existing cron status:', selectError);
    throw new Error(`Failed to check existing cron status: ${selectError.message}`);
  }

  if (existingRecord) {
    // Update existing record
    console.log(`📝 Updating existing cron status record ${existingRecord.id}...`);
    const { error: updateError } = await client
      .from('cron_status')
      .update({
        ...cronStatusRecord,
        updated_at: new Date().toISOString()
      })
      .eq('id', existingRecord.id);

    if (updateError) {
      console.error('❌ Error updating cron status:', updateError);
      throw new Error(`Failed to update cron status: ${updateError.message}`);
    }
    console.log('✅ Successfully updated cron status record');
  } else {
    // Insert new record
    console.log('📝 Inserting new cron status record...');
    const { error: insertError } = await client
      .from('cron_status')
      .insert({
        ...cronStatusRecord,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

    if (insertError) {
      console.error('❌ Error inserting cron status:', insertError);
      throw new Error(`Failed to insert cron status: ${insertError.message}`);
    }
    console.log('✅ Successfully inserted new cron status record');
  }
}

export async function batchUpsertCronStatus(client: SupabaseClient, records: any[]): Promise<void> {
  console.log(`📝 Batch upserting ${records.length} cron status records...`);
  for (const record of records) {
    await upsertCronStatus(client, record);
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


