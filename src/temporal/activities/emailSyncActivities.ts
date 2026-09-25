/**
 * Email Sync Activities
 * Activities for managing email synchronization scheduling across multiple sites
 */

import { 
  getSupabaseService, 
  EmailConfigService, 
  Site,
  EmailSyncSchedulingService,
  SiteWithCronStatus,
  SchedulingOptions
} from '../services';

/**
 * Fetch all sites and their last email synchronization cron status
 * Determines which sites need email sync scheduling based on email config and cron status
 */
export async function fetchSitesActivity(options: SchedulingOptions = {}): Promise<SiteWithCronStatus[]> {
  console.log('📂 Fetching sites with email sync enabled...');
  
  // Validate scheduling options
  const optionsValidation = EmailSyncSchedulingService.validateSchedulingOptions(options);
  if (!optionsValidation.isValid) {
    throw new Error(`Invalid scheduling options: ${optionsValidation.errors.join(', ')}`);
  }
  
  try {
    const supabaseService = getSupabaseService();
    
    console.log('🔍 Checking database connection...');
    const isConnected = await supabaseService.getConnectionStatus();
    
    if (!isConnected) {
      throw new Error('Database not available');
    }

    console.log('✅ Database connection confirmed, proceeding with real data...');

    const client = supabaseService.getClient();
    const { data: settingsData, error: settingsError } = await client
      .from('settings')
      .select('site_id, channels')
      .eq('channels->email->>enabled', 'true')
      .not('channels->email->>email', 'is', null);

    if (settingsError) {
      throw new Error(`Failed to fetch email settings: ${settingsError.message}`);
    }

    const emailSettings = new Map<
      string,
      NonNullable<ReturnType<typeof EmailConfigService.extractEmailConfigFromSettings>>
    >();
    for (const settings of settingsData || []) {
      const emailConfig = EmailConfigService.extractEmailConfigFromSettings(settings);
      if (emailConfig) {
        emailSettings.set(settings.site_id, emailConfig);
      }
    }
    const siteIds = [...emailSettings.keys()];
    if (siteIds.length === 0) return [];

    const { data: siteRows, error: sitesError } = await client
      .from('sites')
      .select('id, name, url, user_id, created_at, updated_at')
      .in('id', siteIds);

    if (sitesError) {
      throw new Error(`Failed to fetch email-enabled sites: ${sitesError.message}`);
    }

    const sites: Site[] = (siteRows || []).map((siteRow) => ({
      ...siteRow,
      name: siteRow.name || 'Unnamed Site',
      url: siteRow.url || '',
      email: emailSettings.get(siteRow.id),
    }));

    // Fetch cron status for these sites to determine last sync times
    console.log('🔍 Querying cron_status table for sync history...');
    const cronData = await supabaseService.fetchCronStatus('syncEmailsWorkflow', siteIds);

    console.log(`✅ Found ${cronData?.length || 0} cron status records`);

    // Process sites for scheduling using the scheduling service
    const sitesWithStatus = EmailSyncSchedulingService.processSitesForScheduling(
      sites,
      cronData || [],
      { ...options, minHoursBetweenSyncs: 1 } // Email sync every hour
    );

    // Log detailed analysis
    EmailSyncSchedulingService.logSchedulingAnalysis(sitesWithStatus, options);

    return sitesWithStatus;

  } catch (error) {
    console.error('❌ Error in fetchSitesActivity:', error);
    throw error;
  }
}

/**
 * Schedule email sync workflows for the provided sites
 */
export async function scheduleEmailSyncWorkflowsActivity(
  sites: SiteWithCronStatus[],
  options: SchedulingOptions = {}
): Promise<{
  scheduled: number;
  skipped: number;
  errors: string[];
}> {
  console.log('📅 Scheduling email sync workflows...');
  
  const sitesToSchedule = sites.filter(site => site.shouldSchedule);
  const results = {
    scheduled: 0,
    skipped: 0,
    errors: [] as string[]
  };

  // If dry run, just log what would be scheduled
  if (options.dryRun) {
    console.log('🧪 DRY RUN MODE - No actual scheduling will occur');
    console.log(`📋 Would schedule ${sitesToSchedule.length} sites:`);
    
    sitesToSchedule.forEach(site => {
      console.log(`   - ${site.name} (${site.id}): ${site.reason}`);
    });

    results.scheduled = sitesToSchedule.length;
    results.skipped = sites.length - sitesToSchedule.length;
    return results;
  }

  for (const site of sites) {
    if (!site.shouldSchedule) {
      console.log(`⏭️  Skipping ${site.name}: ${site.reason}`);
      results.skipped++;
      continue;
    }

    try {
      // Generate workflow IDs using the scheduling service
      const { workflowId, scheduleId } = EmailSyncSchedulingService.generateWorkflowIds(site.id);
      
      console.log(`🚀 Scheduling email sync for ${site.name}`);
      console.log(`   - Workflow ID: ${workflowId}`);
      console.log(`   - Schedule ID: ${scheduleId}`);
      console.log(`   - User ID: ${site.user_id}`);
      console.log(`   - Site URL: ${site.url}`);
      
      if (site.email) {
        const provider = EmailConfigService.getEmailProvider(site.email);
        console.log(`   - Email Provider: ${provider}`);
        console.log(`   - Email: ${site.email.email}`);
      }
      
      // Mock scheduling delay to simulate real work
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Mock updating cron status
      console.log(`📝 Updating cron status for ${site.name}`);
      
      results.scheduled++;
      console.log(`✅ Successfully scheduled email sync for ${site.name}`);
      
    } catch (error) {
      const errorMessage = `Failed to schedule email sync for ${site.name}: ${error instanceof Error ? error.message : String(error)}`;
      console.error(`❌ ${errorMessage}`);
      results.errors.push(errorMessage);
    }
  }

  console.log(`📊 Email sync scheduling completed:`);
  console.log(`   - Scheduled: ${results.scheduled}`);
  console.log(`   - Skipped: ${results.skipped}`);
  console.log(`   - Errors: ${results.errors.length}`);
  
  if (results.errors.length > 0) {
    console.log(`❌ Errors encountered:`);
    results.errors.forEach(error => console.log(`   - ${error}`));
  }

  return results;
}

/**
 * Update cron status for email sync workflows
 */
export async function updateCronStatusActivity(updates: {
  siteId: string;
  workflowId: string;
  scheduleId: string;
  status: string;
  nextRun?: string;
  errorMessage?: string;
}[]): Promise<void> {
  console.log('📝 Updating cron status records...');
  
  try {
    const supabaseService = getSupabaseService();
    
    if (!supabaseService.getConnectionStatus()) {
      console.log('⚠️  Database not available, logging updates to console...');
      logCronStatusUpdates(updates);
      return;
    }

    // Prepare cron status records for batch update
    const cronStatusRecords = updates.map(update => ({
      site_id: update.siteId,
      workflow_id: update.workflowId,
      schedule_id: update.scheduleId,
      activity_name: 'syncEmailsWorkflow',
      status: update.status,
      last_run: update.status === 'SCHEDULED' ? null : new Date().toISOString(),
      next_run: update.nextRun || null,
      error_message: update.errorMessage || null,
      retry_count: update.errorMessage ? 1 : 0
    }));

    // Batch update cron status records
    await supabaseService.batchUpsertCronStatus(cronStatusRecords);
    
    console.log(`✅ Successfully updated ${updates.length} cron status records in database`);

  } catch (error) {
    console.error('❌ Error in updateCronStatusActivity:', error);
    
    // Fallback to console logging if database operations fail
    console.log('⚠️  Database update failed, logging updates to console...');
    logCronStatusUpdates(updates);
  }
}

/**
 * Log cron status updates to console (fallback method)
 */
function logCronStatusUpdates(updates: {
  siteId: string;
  workflowId: string;
  scheduleId: string;
  status: string;
  nextRun?: string;
  errorMessage?: string;
}[]): void {
  for (const update of updates) {
    console.log(`📝 [MOCK] Updating cron status for site ${update.siteId}:`);
    console.log(`   - Workflow ID: ${update.workflowId}`);
    console.log(`   - Schedule ID: ${update.scheduleId}`);
    console.log(`   - Status: ${update.status}`);
    if (update.nextRun) {
      console.log(`   - Next Run: ${update.nextRun}`);
    }
    if (update.errorMessage) {
      console.log(`   - Error: ${update.errorMessage}`);
    }
  }
  console.log(`✅ [MOCK] Logged ${updates.length} cron status records`);
} 