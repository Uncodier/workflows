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
    .limit(50); 

  if (error) {
    throw new Error(`Failed to fetch messages: ${error.message}`);
  }

  if (!messages || messages.length === 0) {
    console.log('✅ No approved messages found.');
    return [];
  }

  console.log(`✅ Found ${messages.length} approved messages.`);

  const enhancedMessages = [];
  
  // We need to get lead info for each message to send it
  // We can do this in parallel or optimized, but for now simple loop is fine for <50 items
  for (const msg of messages) {
    try {
        const { data: conversation } = await supabaseServiceRole
            .from('conversations')
            .select('site_id, lead_id')
            .eq('id', msg.conversation_id)
            .single();

        if (conversation) {
             const { data: lead } = await supabaseServiceRole
                .from('leads')
                .select('id, email, phone, name')
                .eq('id', conversation.lead_id)
                .single();

             if (lead) {
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
                     created_at: msg.created_at
                 });
             } else {
                 console.warn(`⚠️ Lead not found for conversation ${msg.conversation_id}`);
             }
        } else {
            console.warn(`⚠️ Conversation not found for message ${msg.id}`);
        }
    } catch (e) {
        console.error(`⚠️ Error enriching message ${msg.id}`, e);
    }
  }

  return enhancedMessages;
}
