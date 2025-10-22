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
        thresholdDate: thresholdIso,
        errors: ['Database not available']
      };
    }

    // Use service-role client for server-side filtering
    const { supabaseServiceRole } = await import('../../lib/supabase/client');

    // Step 1: Fetch candidate leads by status for this site
    // Exclude: new, converted, canceled/cancelled, lost
    const { data: candidateLeads, error: leadsError } = await supabaseServiceRole
      .from('leads')
      .select('id, name, email, phone, status, site_id')
      .eq('site_id', siteId)
      .neq('status', 'new')
      .neq('status', 'converted')
      .neq('status', 'canceled')
      .neq('status', 'cancelled')
      .neq('status', 'lost')
      .order('updated_at', { ascending: false })
      .limit(500); // cap to avoid excessive N+1 queries

    if (leadsError) {
      return {
        success: false,
        leads: [],
        totalChecked: 0,
        considered: 0,
        thresholdDate: thresholdIso,
        errors: [leadsError.message]
      };
    }

    const results: any[] = [];
    let totalChecked = 0;

    // Step 2: For each candidate, find latest ASSISTANT (our) message across their conversations
    for (const lead of candidateLeads || []) {
      if (results.length >= limit) break;
      totalChecked++;

      // Find conversations for the lead (most recent first)
      const { data: conversations, error: convError } = await supabaseServiceRole
        .from('conversations')
        .select('id')
        .eq('lead_id', lead.id)
        .eq('site_id', siteId)
        .order('created_at', { ascending: false })
        .limit(5);

      if (convError) {
        errors.push(`Failed to fetch conversations for lead ${lead.id}: ${convError.message}`);
        continue;
      }

      if (!conversations || conversations.length === 0) {
        // No conversations found; attempt fallback by lead_id below
      }

      // For a small set of latest conversations, find the latest ASSISTANT message
      let latestAssistantMessageIso: string | null = null;
      let hasRecentMessages = false;

      for (const conv of conversations || []) {
        // Check if there are ANY assistant messages within the threshold period
        const { data: recentMessages, error: recentError } = await supabaseServiceRole
          .from('messages')
          .select('id, created_at')
          .eq('conversation_id', conv.id)
          .eq('role', 'assistant')
          .gte('created_at', thresholdIso) // Messages newer than threshold
          .limit(1);

        if (recentError) {
          errors.push(`Failed to fetch recent assistant messages for conversation ${conv.id}: ${recentError.message}`);
          continue;
        }

        if (recentMessages && recentMessages.length > 0) {
          hasRecentMessages = true;
          console.log(`⏭️ Lead ${lead.id} has recent assistant message within last ${daysWithoutReply} days - skipping`);
          break; // No need to check other conversations
        }

        // Also get the latest message for historical reference
        const { data: assistantMsg, error: msgError } = await supabaseServiceRole
          .from('messages')
          .select('id, created_at')
          .eq('conversation_id', conv.id)
          .eq('role', 'assistant')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (msgError) {
          errors.push(`Failed to fetch last assistant message for conversation ${conv.id}: ${msgError.message}`);
          continue;
        }

        if (assistantMsg && assistantMsg.created_at) {
          if (!latestAssistantMessageIso || assistantMsg.created_at > latestAssistantMessageIso) {
            latestAssistantMessageIso = assistantMsg.created_at;
          }
        }
      }

      // Fallback: If no assistant message found via conversations, try by lead_id
      if (!latestAssistantMessageIso && !hasRecentMessages) {
        // Check for recent messages by lead_id as well
        const { data: recentMessagesByLead, error: recentByLeadError } = await supabaseServiceRole
          .from('messages')
          .select('id, created_at')
          .eq('lead_id', lead.id)
          .eq('role', 'assistant')
          .gte('created_at', thresholdIso) // Messages newer than threshold
          .limit(1);

        if (recentByLeadError) {
          errors.push(`Failed to fetch recent assistant messages by lead ${lead.id}: ${recentByLeadError.message}`);
        }

        if (recentMessagesByLead && recentMessagesByLead.length > 0) {
          hasRecentMessages = true;
          console.log(`⏭️ Lead ${lead.id} has recent assistant message within last ${daysWithoutReply} days (fallback check) - skipping`);
        }

        // Also get the latest message for historical reference
        const { data: assistantMsgByLead, error: byLeadError } = await supabaseServiceRole
          .from('messages')
          .select('id, created_at')
          .eq('lead_id', lead.id)
          .eq('role', 'assistant')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (byLeadError) {
          errors.push(`Failed to fetch assistant message by lead ${lead.id}: ${byLeadError.message}`);
        }

        if (assistantMsgByLead && assistantMsgByLead.created_at) {
          latestAssistantMessageIso = assistantMsgByLead.created_at;
        }
      }

      // Skip if there are recent assistant messages (within last 7 days)
      if (hasRecentMessages) {
        console.log(`⏭️ Skipping lead ${lead.id} - has assistant message within last ${daysWithoutReply} days`);
        continue;
      }

      // Must have at least one assistant message historically
      if (!latestAssistantMessageIso) continue;

      // Log decision context for auditing
      console.log(`Qualification check lead=${lead.id} lastAssistant=${latestAssistantMessageIso} threshold=${thresholdIso}`);

      // Only include if there's at least one old message AND no recent messages
      if (latestAssistantMessageIso && latestAssistantMessageIso < thresholdIso) {
        results.push(lead);
      }
    }

    return {
      success: true,
      leads: results,
      totalChecked,
      considered: candidateLeads?.length || 0,
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
      thresholdDate: thresholdIso,
      errors: [message]
    };
  }
}


