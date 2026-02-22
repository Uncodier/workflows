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
