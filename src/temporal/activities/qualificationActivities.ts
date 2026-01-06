import { getSupabaseService } from '../services/supabaseService';

export interface GetQualificationLeadsParams {
  site_id: string;
  daysWithoutReply?: number; // default 7
  limit?: number; // default 30
}

export interface GetQualificationLeadsResult {
  success: boolean;
  leads: any[];
  totalChecked: number;
  considered: number;
  excludedByAssignee: number;
  thresholdDate: string;
  errors?: string[];
}

/**
 * Fetch leads for follow-up where OUR last message (assistant) is older than N days,
 * regardless of recent user replies. This allows follow-up even if the user replied recently,
 * as long as we haven't sent a follow-up in the configured window.
 *
 * Excludes leads with status in ['new', 'converted', 'canceled', 'cancelled', 'lost'].
 * Prevents spam by excluding leads that have received assistant messages within the threshold period.
 *
 * Strategy (conservative, multi-step for correctness):
 *  - Fetch candidate leads for the site by allowed statuses (ordered by updated_at DESC)
 *  - For each candidate, check if there are ANY assistant messages within the threshold period
 *  - Skip leads that have recent assistant messages (within last N days)
 *  - Include the lead only if the latest assistant message is older than thresholdDate AND no recent messages exist
 */
export async function getQualificationLeadsActivity(
  params: GetQualificationLeadsParams
): Promise<GetQualificationLeadsResult> {
  const siteId = params.site_id;
  const daysWithoutReply = typeof params.daysWithoutReply === 'number' ? params.daysWithoutReply : 7;
  const limit = typeof params.limit === 'number' ? params.limit : 30;

  const threshold = new Date(Date.now() - daysWithoutReply * 24 * 60 * 60 * 1000);
  const thresholdIso = threshold.toISOString();

  const errors: string[] = [];

  try {
    const supabaseService = getSupabaseService();

    const isConnected = await supabaseService.getConnectionStatus();
    if (!isConnected) {
      return {
        success: false,
        leads: [],
        totalChecked: 0,
        considered: 0,
        excludedByAssignee: 0,
        thresholdDate: thresholdIso,
        errors: ['Database not available']
      };
    }

    // Use service-role client for server-side filtering
    const { supabaseServiceRole } = await import('../../lib/supabase/client');

    // Step 1: Fetch candidate leads by status for this site
    // Exclude: new, converted, canceled/cancelled, lost, cold, not_qualified
    const { data: candidateLeads, error: leadsError } = await supabaseServiceRole
      .from('leads')
      .select('id, name, email, phone, status, site_id, assignee_id')
      .eq('site_id', siteId)
      .neq('status', 'new')
      .neq('status', 'converted')
      .neq('status', 'canceled')
      .neq('status', 'cancelled')
      .neq('status', 'lost')
      .neq('status', 'cold')
      .neq('status', 'not_qualified')
      .order('updated_at', { ascending: false })
      .limit(500); // cap to avoid excessive N+1 queries

    if (leadsError) {
      return {
        success: false,
        leads: [],
        totalChecked: 0,
        considered: 0,
        excludedByAssignee: 0,
        thresholdDate: thresholdIso,
        errors: [leadsError.message]
      };
    }

    const results: any[] = [];
    let totalChecked = 0;
    let excludedByAssignee = 0;

    // Step 2: For each candidate, find latest ASSISTANT (our) message directly from messages table
    for (const lead of candidateLeads || []) {
      if (results.length >= limit) break;
      totalChecked++;

      // Skip leads that have an assignee_id
      if (lead.assignee_id) {
        console.log(`⏭️ Skipping lead ${lead.id} - has assignee_id (${lead.assignee_id})`);
        excludedByAssignee++;
        continue;
      }

      // 1. Global Recent Message Check: Check if ANY assistant message exists for the lead_id created after the thresholdIso
      // This is much more robust than iterating through conversations as it catches messages in any conversation
      // We also enforce site_id check through conversations table to prevent cross-site data contamination
      const { data: recentMessages, error: recentError } = await supabaseServiceRole
        .from('messages')
        .select('id, created_at, conversations!inner(site_id)')
        .eq('lead_id', lead.id)
        .eq('role', 'assistant')
        .eq('conversations.site_id', siteId)
        .gte('created_at', thresholdIso)
        .limit(1);

      if (recentError) {
        errors.push(`Failed to fetch recent assistant messages for lead ${lead.id}: ${recentError.message}`);
        continue;
      }

      if (recentMessages && recentMessages.length > 0) {
        console.log(`⏭️ Lead ${lead.id} has recent assistant message within last ${daysWithoutReply} days - skipping`);
        continue;
      }

      // 2. Historical Message Check: If no recent message is found, verify that the lead has received at least one assistant message in the past
      // This ensures we are following up on an existing dialogue and not contacting cold/new leads incorrectly
      const { data: lastMessage, error: lastMsgError } = await supabaseServiceRole
        .from('messages')
        .select('created_at, conversations!inner(site_id)')
        .eq('lead_id', lead.id)
        .eq('role', 'assistant')
        .eq('conversations.site_id', siteId)
        .lt('created_at', thresholdIso) // Older than threshold
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (lastMsgError) {
        errors.push(`Failed to fetch last assistant message for lead ${lead.id}: ${lastMsgError.message}`);
        continue;
      }

      // Only include if there's at least one old message
      if (lastMessage) {
        // Log decision context for auditing
        console.log(`Qualification check lead=${lead.id} lastAssistant=${lastMessage.created_at} threshold=${thresholdIso}`);
        results.push(lead);
      }
    }

    console.log(`📊 Qualification leads summary: ${results.length} qualified, ${excludedByAssignee} excluded by assignee, ${totalChecked} total checked`);
    
    return {
      success: true,
      leads: results,
      totalChecked,
      considered: candidateLeads?.length || 0,
      excludedByAssignee,
      thresholdDate: thresholdIso,
      errors: errors.length ? errors : undefined
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      leads: [],
      totalChecked: 0,
      considered: 0,
      excludedByAssignee: 0,
      thresholdDate: thresholdIso,
      errors: [message]
    };
  }
}


