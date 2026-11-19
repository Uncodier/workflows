import { getSupabaseService } from '../../services';
import { normalizeIcpMiningListIds } from '../../utils/icpMiningConfiguration';
import { ICP_MINING_WORKFLOW_SELECT, IcpMiningWorkflowDto, toIcpMiningWorkflowDto } from '../../utils/icpMiningPayload';

// Get role query data by ID
export async function getRoleQueryByIdActivity(id: string): Promise<{
  success: boolean;
  roleQuery?: any;
  error?: string;
}> {
  try {
    const supabaseService = getSupabaseService();
    const isConnected = await supabaseService.getConnectionStatus();
    if (!isConnected) {
      return { success: false, error: 'Database not available' };
    }
    const { supabaseServiceRole } = await import('../../../lib/supabase/client');
    const { data, error } = await supabaseServiceRole
      .from('role_queries')
      .select('*')
      .eq('id', id)
      .single();
    if (error) {
      return { success: false, error: error.message };
    }
    return { success: true, roleQuery: data };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

// Read ICP Mining by ID
export async function getIcpMiningByIdActivity(id: string): Promise<{
  success: boolean;
  icp?: IcpMiningWorkflowDto | null;
  error?: string;
}> {
  try {
    const supabaseService = getSupabaseService();
    const isConnected = await supabaseService.getConnectionStatus();
    if (!isConnected) {
      return { success: false, error: 'Database not available' };
    }
    const { supabaseServiceRole } = await import('../../../lib/supabase/client');
    const { data, error } = await supabaseServiceRole
      .from('icp_mining')
      .select(ICP_MINING_WORKFLOW_SELECT)
      .eq('id', id)
      .single();
    if (error) {
      return { success: false, error: error.message };
    }
    return { success: true, icp: data ? toIcpMiningWorkflowDto(data) : null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

// Update ICP Mining progress and status
export async function updateIcpMiningProgressActivity(options: {
  id: string;
  deltaProcessed?: number;
  deltaFound?: number;
  processedTargets?: number; // Absolute retry-safe checkpoint for configured mining
  foundMatches?: number;
  status?: 'pending' | 'running' | 'completed' | 'failed';
  totalTargets?: number;
  last_error?: string | null;
  appendError?: string; // push into errors[]
  currentPage?: number;
  currentPageOffset?: number;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const supabaseService = getSupabaseService();
    const isConnected = await supabaseService.getConnectionStatus();
    if (!isConnected) {
      return { success: false, error: 'Database not available' };
    }
    const { supabaseServiceRole } = await import('../../../lib/supabase/client');

    // Fetch current row
    const { data: current, error: fetchError } = await supabaseServiceRole
      .from('icp_mining')
      .select('processed_targets, found_matches, errors, total_targets')
      .eq('id', options.id)
      .single();
    if (fetchError) {
      return { success: false, error: fetchError.message };
    }

    const newProcessed = options.processedTargets ?? ((current?.processed_targets || 0) + (options.deltaProcessed || 0));
    const newFound = options.foundMatches ?? ((current?.found_matches || 0) + (options.deltaFound || 0));
    const errors = Array.isArray(current?.errors) ? current.errors.slice() : [];
    if (options.appendError) {
      errors.push({ timestamp: new Date().toISOString(), message: options.appendError });
    }

    const updates: any = {
      processed_targets: newProcessed,
      found_matches: newFound,
      last_progress_at: new Date().toISOString(),
      ...(options.status && { status: options.status }),
      // Only update total_targets if explicitly provided, otherwise preserve existing value
      ...(options.totalTargets !== undefined && { total_targets: options.totalTargets }),
      ...(options.last_error !== undefined && { last_error: options.last_error }),
      errors,
      ...(options.currentPage !== undefined && { current_page: options.currentPage }),
      ...(options.currentPageOffset !== undefined && { current_page_offset: options.currentPageOffset }),
    };

    const { error: updateError } = await supabaseServiceRole
      .from('icp_mining')
      .update(updates)
      .eq('id', options.id);

    if (updateError) {
      return { success: false, error: updateError.message };
    }
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

// Mark ICP mining started
export async function markIcpMiningStartedActivity(options: { id: string }): Promise<{ success: boolean; error?: string }> {
  try {
    const supabaseService = getSupabaseService();
    const isConnected = await supabaseService.getConnectionStatus();
    if (!isConnected) return { success: false, error: 'Database not available' };
    const { supabaseServiceRole } = await import('../../../lib/supabase/client');
    const { error } = await supabaseServiceRole
      .from('icp_mining')
      .update({ status: 'running', started_at: new Date().toISOString(), last_progress_at: new Date().toISOString() })
      .eq('id', options.id);
    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

// Mark ICP mining completed
export async function markIcpMiningCompletedActivity(options: { id: string; failed?: boolean; last_error?: string | null }): Promise<{ success: boolean; error?: string }> {
  try {
    const supabaseService = getSupabaseService();
    const isConnected = await supabaseService.getConnectionStatus();
    if (!isConnected) return { success: false, error: 'Database not available' };
    const { supabaseServiceRole } = await import('../../../lib/supabase/client');
    const { error } = await supabaseServiceRole
      .from('icp_mining')
      .update({ status: options.failed ? 'failed' : 'completed', finished_at: new Date().toISOString(), last_error: options.last_error ?? null })
      .eq('id', options.id);
    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

// List pending ICP Mining rows (optionally limited and filtered by site_id)
export async function getPendingIcpMiningActivity(options?: { limit?: number; site_id?: string; icp_mining_ids?: string[] }): Promise<{
  success: boolean;
  items?: IcpMiningWorkflowDto[];
  error?: string;
}> {
  try {
    const selectedIds = options?.icp_mining_ids === undefined ? undefined : normalizeIcpMiningListIds(options.icp_mining_ids);
    if (selectedIds !== undefined && !options?.site_id) return { success: false, error: 'site_id is required for selected ICP lists' };
    if (selectedIds?.length === 0) return { success: true, items: [] };
    const supabaseService = getSupabaseService();
    const isConnected = await supabaseService.getConnectionStatus();
    if (!isConnected) return { success: false, error: 'Database not available' };
    const { supabaseServiceRole } = await import('../../../lib/supabase/client');

    const limit = options?.limit && options.limit > 0 ? options.limit : 50;
    if (selectedIds) {
      const items: IcpMiningWorkflowDto[] = [];
      // Filter before LIMIT, with bounded URLs even for a large selection.
      for (let offset = 0; offset < selectedIds.length; offset += 100) {
        const { data, error } = await supabaseServiceRole.from('icp_mining').select(ICP_MINING_WORKFLOW_SELECT)
          .eq('site_id', options!.site_id!).in('status', ['running', 'pending'])
          .in('id', selectedIds.slice(offset, offset + 100))
          .order('created_at', { ascending: true }).order('id', { ascending: true }).limit(limit);
        if (error) return { success: false, error: error.message };
        items.push(...(data || []).map(toIcpMiningWorkflowDto));
      }
      items.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || String(a.id).localeCompare(String(b.id)));
      return { success: true, items: items.slice(0, limit) };
    }
    let query = supabaseServiceRole
      .from('icp_mining')
      .select(ICP_MINING_WORKFLOW_SELECT)
      .in('status', ['running', 'pending'])
      .order('created_at', { ascending: true })
      .limit(limit);

    // Filter by site_id if provided
    if (options?.site_id) {
      query = query.eq('site_id', options.site_id);
    }

    console.log(`🔍 ICP Mining Query: site_id=${options?.site_id}, limit=${limit}`);
    
    // First, let's check what records exist for this site_id (any status)
    const { data: allRecords } = await supabaseServiceRole
      .from('icp_mining')
      .select('id, status, site_id, name, created_at')
      .eq('site_id', options?.site_id || '')
      .order('created_at', { ascending: false })
      .limit(10);
    
    console.log(`📊 All ICP Mining records for site_id ${options?.site_id}:`, allRecords);
    
    const { data, error } = await query;

    if (error) {
      console.error(`❌ ICP Mining Query Error:`, error);
      return { success: false, error: error.message };
    }
    
    console.log(`📊 ICP Mining Results: found ${data?.length || 0} items`);
    if (data && data.length > 0) {
      console.log(`📋 Sample ICP Mining item:`, {
        id: data[0].id,
        status: data[0].status,
        site_id: data[0].site_id,
        role_query_id: data[0].role_query_id,
      });
    }
    
    return { success: true, items: (data || []).map(toIcpMiningWorkflowDto) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

/**
 * Get segment_id from role_query_segments relationship
 */
export async function getSegmentIdFromRoleQueryActivity(roleQueryId: string): Promise<{
  success: boolean;
  segmentId?: string;
  error?: string;
}> {
  try {
    const supabaseService = getSupabaseService();
    const isConnected = await supabaseService.getConnectionStatus();
    if (!isConnected) return { success: false, error: 'Database not available' };
    
    const { supabaseServiceRole } = await import('../../../lib/supabase/client');

    const { data: roleQuerySegment, error } = await supabaseServiceRole
      .from('role_query_segments')
      .select('segment_id')
      .eq('role_query_id', roleQueryId)
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('❌ Error fetching segment from role_query_segments:', error);
      return { success: false, error: error.message };
    }

    if (!roleQuerySegment) {
      console.log(`⚠️ No segment found for role_query_id: ${roleQueryId}`);
      return { success: true, segmentId: undefined };
    }

    console.log(`✅ Found segment_id: ${roleQuerySegment.segment_id} for role_query_id: ${roleQueryId}`);
    return { success: true, segmentId: roleQuerySegment.segment_id };
    
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}
