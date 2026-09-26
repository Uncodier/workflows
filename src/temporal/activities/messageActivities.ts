import { getSupabaseService } from '../services/supabaseService';

const APPROVED_MESSAGE_BATCH_SIZE = 100;
const RELATED_RECORD_BATCH_SIZE = 100;

export function buildUnprocessableMessageCustomData(
  customData: Record<string, unknown> | null,
  reason: string
): Record<string, unknown> {
  return {
    ...(customData ?? {}),
    status: 'failed',
    command_status: 'failed',
    error_message: reason,
    delivery: {
      channel: 'unknown',
      success: false,
      timestamp: new Date().toISOString(),
      details: { error: reason },
    },
  };
}

export async function getApprovedMessagesActivity(): Promise<any[]> {
  console.log('🔍 Fetching approved messages...');
  const supabaseService = getSupabaseService();
  const isConnected = await supabaseService.getConnectionStatus();

  if (!isConnected) {
    throw new Error('Database not available');
  }

  const { supabaseServiceRole } = await import('../../lib/supabase/client');

  // Fetch messages with status 'accepted'
  // We filter by custom_data->>status = 'accepted'
  // We assume 'accepted' means approved by user.
  // We order by created_at to process oldest first.
  const { data: messages, error } = await supabaseServiceRole
    .from('messages')
    .select(`
      id,
      content,
      custom_data,
      conversation_id,
      created_at
    `)
    .eq('custom_data->>status', 'accepted')
    .order('created_at', { ascending: true })
    .limit(APPROVED_MESSAGE_BATCH_SIZE);

  if (error) {
    throw new Error(`Failed to fetch messages: ${error.message}`);
  }

  if (!messages || messages.length === 0) {
    console.log('✅ No approved messages found.');
    return [];
  }

  console.log(`✅ Found ${messages.length} approved messages.`);

  const conversationIds = [...new Set(messages.map((m) => m.conversation_id).filter(Boolean))];
  const conversationMap = new Map<string, { site_id: string; lead_id: string; channel: string | null }>();

  for (let i = 0; i < conversationIds.length; i += RELATED_RECORD_BATCH_SIZE) {
    const batch = conversationIds.slice(i, i + RELATED_RECORD_BATCH_SIZE);
    const { data: conversations, error: convError } = await supabaseServiceRole
      .from('conversations')
      .select('id, site_id, lead_id, channel, custom_data')
      .in('id', batch);

    if (convError) {
      throw new Error(`Failed to fetch conversation batch: ${convError.message}`);
    }
    if (conversations) {
      for (const c of conversations) {
        const channel = c.channel || (c.custom_data as Record<string, any>)?.channel || null;
        conversationMap.set(c.id, { site_id: c.site_id, lead_id: c.lead_id, channel });
      }
    }
  }

  const leadIds = [...new Set([...conversationMap.values()].map((c) => c.lead_id).filter(Boolean))];
  const leadMap = new Map<string, {
    id: string;
    email: string | null;
    phone: string | null;
    name: string | null;
    metadata: Record<string, unknown> | null;
  }>();

  for (let i = 0; i < leadIds.length; i += RELATED_RECORD_BATCH_SIZE) {
    const batch = leadIds.slice(i, i + RELATED_RECORD_BATCH_SIZE);
    const { data: leads, error: leadError } = await supabaseServiceRole
      .from('leads')
      .select('id, email, phone, name, metadata')
      .in('id', batch);

    if (leadError) {
      throw new Error(`Failed to fetch lead batch: ${leadError.message}`);
    }
    if (leads) {
      for (const l of leads) {
        leadMap.set(l.id, {
          id: l.id, email: l.email ?? null, phone: l.phone ?? null,
          name: l.name ?? null, metadata: l.metadata ?? null,
        });
      }
    }
  }

  const enhancedMessages: any[] = [];
  const unprocessableMessages: Array<{
    id: string;
    customData: Record<string, unknown> | null;
    reason: string;
  }> = [];

  for (const msg of messages) {
    try {
      const conversation = conversationMap.get(msg.conversation_id);
      if (!conversation) {
        const reason = `Conversation ${msg.conversation_id || '(missing)'} not found`;
        console.warn(`⚠️ ${reason} for message ${msg.id}`);
        unprocessableMessages.push({
          id: msg.id,
          customData: msg.custom_data,
          reason,
        });
        continue;
      }
      const lead = leadMap.get(conversation.lead_id);
      if (!lead) {
        const reason = `Lead ${conversation.lead_id || '(missing)'} not found`;
        console.warn(`⚠️ ${reason} for conversation ${msg.conversation_id}`);
        unprocessableMessages.push({
          id: msg.id,
          customData: msg.custom_data,
          reason,
        });
        continue;
      }
      // Incident quarantine is a delivery veto, even if a pending response is
      // later approved. Keep the message and its history for review.
      if (lead.metadata?.quarantined_cross_tenant === true) {
        console.warn(`Skipping approved message ${msg.id}: cross-tenant lead is quarantined`);
        continue;
      }
      enhancedMessages.push({
        message_id: msg.id,
        conversation_id: msg.conversation_id,
        content: msg.content,
        custom_data: msg.custom_data,
        site_id: conversation.site_id,
        lead_id: lead.id,
        lead_email: lead.email,
        lead_phone: lead.phone,
        lead_name: lead.name,
        created_at: msg.created_at,
        channel: conversation.channel,
      });
    } catch (e) {
      console.error(`⚠️ Error enriching message ${msg.id}`, e);
      unprocessableMessages.push({
        id: msg.id,
        customData: msg.custom_data,
        reason: e instanceof Error ? e.message : String(e),
      });
    }
  }

  for (const invalidMessage of unprocessableMessages) {
    const { error: updateError } = await supabaseServiceRole
      .from('messages')
      .update({
        custom_data: buildUnprocessableMessageCustomData(
          invalidMessage.customData,
          invalidMessage.reason
        ),
        updated_at: new Date().toISOString(),
      })
      .eq('id', invalidMessage.id)
      .eq('custom_data->>status', 'accepted');

    if (updateError) {
      console.error(
        `❌ Failed to mark unprocessable message ${invalidMessage.id}:`,
        updateError
      );
    }
  }

  return enhancedMessages;
}

/**
 * Atomically claim a message by marking it as 'sending' only if it is still 'accepted'.
 * Prevents duplicate sends when schedule overlap is ALLOW: only one concurrent workflow
 * can win the claim; others get success: false and must skip starting the child.
 */
export interface MessageClaimRequest {
  message_id: string;
  conversation_id: string;
  site_id: string;
}

export async function claimApprovedMessagesBatchActivity(
  requests: MessageClaimRequest[]
): Promise<string[]> {
  if (requests.length === 0) return [];

  const supabaseService = getSupabaseService();
  if (!await supabaseService.getConnectionStatus()) {
    throw new Error('Database not available');
  }

  const { supabaseServiceRole } = await import('../../lib/supabase/client');
  const { data, error } = await supabaseServiceRole.rpc(
    'claim_approved_messages_batch',
    {
      p_messages: requests.map(({ message_id, conversation_id }) => ({
        message_id,
        conversation_id,
      })),
    }
  );

  if (error) {
    throw new Error(`Failed to claim approved messages: ${error.message}`);
  }

  return (data || []).map((row: { message_id: string }) => row.message_id);
}

export async function markMessageAsSendingActivity(
  request: MessageClaimRequest
): Promise<{ success: boolean; error?: string }> {
  const { message_id, conversation_id, site_id } = request;
  console.log(`📝 Claiming message ${message_id} as sending (site: ${site_id})...`);

  try {
    const claimedIds = await claimApprovedMessagesBatchActivity([request]);
    if (!claimedIds.includes(message_id)) {
      return { success: false, error: 'Message already claimed' };
    }
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Minutes after which a message in 'sending' is considered stuck (child crashed before updating).
 * Must be longer than sendWhatsappFromAgentWorkflow template retry backoffs (1m + 30m + 1h + 6h = 451m)
 * so we never reset a message whose child is still running (e.g. waiting for template delivery retry).
 */
const STUCK_SENDING_THRESHOLD_MINUTES = 500;

/**
 * Reset messages stuck in 'sending' back to 'accepted' so they are picked up again by the next run.
 * Called at the start of sendApprovedMessagesWorkflow to recover from child workflow crashes.
 */
export async function resetStuckSendingMessagesActivity(): Promise<{ resetCount: number; error?: string }> {
  console.log('🔄 Checking for messages stuck in sending...');
  const supabaseService = getSupabaseService();
  const isConnected = await supabaseService.getConnectionStatus();
  if (!isConnected) {
    return { resetCount: 0, error: 'Database not available' };
  }

  const { supabaseServiceRole } = await import('../../lib/supabase/client');
  const cutoff = new Date(Date.now() - STUCK_SENDING_THRESHOLD_MINUTES * 60 * 1000);
  const { data, error } = await supabaseServiceRole.rpc(
    'reset_stuck_sending_messages',
    {
      p_cutoff: cutoff.toISOString(),
      p_limit: 500,
    }
  );

  if (error) {
    console.error('❌ resetStuckSendingMessages failed:', error);
    return { resetCount: 0, error: error.message };
  }

  const resetCount = Number(data || 0);
  if (resetCount > 0) {
    console.log(`✅ Reset ${resetCount} stuck sending message(s) to accepted (older than ${STUCK_SENDING_THRESHOLD_MINUTES} min).`);
  }
  return { resetCount };
}
