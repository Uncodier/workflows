import { getSupabaseService } from '../services/supabaseService';

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
    .limit(500); 

  if (error) {
    throw new Error(`Failed to fetch messages: ${error.message}`);
  }

  if (!messages || messages.length === 0) {
    console.log('✅ No approved messages found.');
    return [];
  }

  console.log(`✅ Found ${messages.length} approved messages.`);

  const BATCH_SIZE = 100;

  const conversationIds = [...new Set(messages.map((m) => m.conversation_id).filter(Boolean))];
  const conversationMap = new Map<string, { site_id: string; lead_id: string }>();

  for (let i = 0; i < conversationIds.length; i += BATCH_SIZE) {
    const batch = conversationIds.slice(i, i + BATCH_SIZE);
    try {
      const { data: conversations, error: convError } = await supabaseServiceRole
        .from('conversations')
        .select('id, site_id, lead_id')
        .in('id', batch);

      if (convError) {
        console.error(`⚠️ Failed to fetch conversation batch: ${convError.message}`);
        continue;
      }
      if (conversations) {
        for (const c of conversations) {
          conversationMap.set(c.id, { site_id: c.site_id, lead_id: c.lead_id });
        }
      }
    } catch (e) {
      console.error(`⚠️ Error fetching conversation batch (${batch.length} ids):`, e);
    }
  }

  const leadIds = [...new Set([...conversationMap.values()].map((c) => c.lead_id).filter(Boolean))];
  const leadMap = new Map<string, { id: string; email: string | null; phone: string | null; name: string | null }>();

  for (let i = 0; i < leadIds.length; i += BATCH_SIZE) {
    const batch = leadIds.slice(i, i + BATCH_SIZE);
    try {
      const { data: leads, error: leadError } = await supabaseServiceRole
        .from('leads')
        .select('id, email, phone, name')
        .in('id', batch);

      if (leadError) {
        console.error(`⚠️ Failed to fetch lead batch: ${leadError.message}`);
        continue;
      }
      if (leads) {
        for (const l of leads) {
          leadMap.set(l.id, { id: l.id, email: l.email ?? null, phone: l.phone ?? null, name: l.name ?? null });
        }
      }
    } catch (e) {
      console.error(`⚠️ Error fetching lead batch (${batch.length} ids):`, e);
    }
  }

  const enhancedMessages: any[] = [];
  for (const msg of messages) {
    try {
      const conversation = conversationMap.get(msg.conversation_id);
      if (!conversation) {
        console.warn(`⚠️ Conversation not found for message ${msg.id}`);
        continue;
      }
      const lead = leadMap.get(conversation.lead_id);
      if (!lead) {
        console.warn(`⚠️ Lead not found for conversation ${msg.conversation_id}`);
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
      });
    } catch (e) {
      console.error(`⚠️ Error enriching message ${msg.id}`, e);
    }
  }

  return enhancedMessages;
}

/**
 * Atomically claim a message by marking it as 'sending' only if it is still 'accepted'.
 * Prevents duplicate sends when schedule overlap is ALLOW: only one concurrent workflow
 * can win the claim; others get success: false and must skip starting the child.
 */
export async function markMessageAsSendingActivity(request: {
  message_id: string;
  conversation_id: string;
  site_id: string;
}): Promise<{ success: boolean; error?: string }> {
  const { message_id, conversation_id, site_id } = request;
  console.log(`📝 Claiming message ${message_id} as sending (site: ${site_id})...`);

  const supabaseService = getSupabaseService();
  const isConnected = await supabaseService.getConnectionStatus();
  if (!isConnected) {
    return { success: false, error: 'Database not available' };
  }

  const { supabaseServiceRole } = await import('../../lib/supabase/client');

  // Fetch current custom_data so we can merge and set status; we need it for the update payload.
  const { data: row, error: fetchErr } = await supabaseServiceRole
    .from('messages')
    .select('id, custom_data')
    .eq('id', message_id)
    .eq('conversation_id', conversation_id)
    .eq('custom_data->>status', 'accepted')
    .single();

  if (fetchErr || !row) {
    const err = fetchErr?.message ?? 'Message not found or already claimed';
    console.log(`⏭️ markMessageAsSending skip (no row or not accepted): ${message_id}`);
    return { success: false, error: err };
  }

  const customData = (row.custom_data as Record<string, unknown>) || {};
  const updated = { ...customData, status: 'sending' as string };

  // Atomic conditional update: only update if still accepted (handles race with other workflows).
  const { data: updatedRows, error: updateErr } = await supabaseServiceRole
    .from('messages')
    .update({ custom_data: updated, updated_at: new Date().toISOString() })
    .eq('id', message_id)
    .eq('conversation_id', conversation_id)
    .eq('custom_data->>status', 'accepted')
    .select('id');

  if (updateErr) {
    console.error(`❌ markMessageAsSending update failed:`, updateErr);
    return { success: false, error: updateErr.message };
  }

  if (!updatedRows || updatedRows.length === 0) {
    console.log(`⏭️ Message ${message_id} already claimed by another workflow`);
    return { success: false, error: 'Message already claimed' };
  }

  console.log(`✅ Message ${message_id} marked as sending`);
  return { success: true };
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
  const cutoffIso = cutoff.toISOString();

  const { data: stuck, error: fetchErr } = await supabaseServiceRole
    .from('messages')
    .select('id, conversation_id, custom_data')
    .eq('custom_data->>status', 'sending')
    .lt('updated_at', cutoffIso)
    .limit(500);

  if (fetchErr) {
    console.error('❌ resetStuckSendingMessages fetch failed:', fetchErr);
    return { resetCount: 0, error: fetchErr.message };
  }

  if (!stuck || stuck.length === 0) {
    return { resetCount: 0 };
  }

  let resetCount = 0;
  for (const row of stuck) {
    const customData = (row.custom_data as Record<string, unknown>) || {};
    const updated = { ...customData, status: 'accepted' as string };
    // Only update if still 'sending' (atomic): avoids overwriting 'sent' if child completed between fetch and update
    const { data: updatedRows, error: updateErr } = await supabaseServiceRole
      .from('messages')
      .update({ custom_data: updated, updated_at: new Date().toISOString() })
      .eq('id', row.id)
      .eq('conversation_id', row.conversation_id)
      .eq('custom_data->>status', 'sending')
      .select('id');

    if (updateErr) {
      console.error(`❌ resetStuckSendingMessages update failed for ${row.id}:`, updateErr);
      continue;
    }
    if (updatedRows && updatedRows.length > 0) {
      resetCount++;
    }
  }

  if (resetCount > 0) {
    console.log(`✅ Reset ${resetCount} stuck sending message(s) to accepted (older than ${STUCK_SENDING_THRESHOLD_MINUTES} min).`);
  }
  return { resetCount };
}
