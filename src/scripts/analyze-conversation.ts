import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = 'https://rnjgeloamtszdjplmqxy.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function analyze() {
  const conversationId = 'f7cba9fb-844d-4a44-a61d-d92fd03606b1';
  
  console.log(`Analyzing conversation: ${conversationId}`);
  
  // Get conversation and lead info
  const { data: conv, error: convError } = await supabase
    .from('conversations')
    .select('*, lead_id, site_id')
    .eq('id', conversationId)
    .single();
    
  if (convError) {
    console.error('Error fetching conversation:', convError);
  } else {
    console.log('Conversation:', { id: conv.id, lead_id: conv.lead_id, site_id: conv.site_id });
    
    if (conv.lead_id) {
      const { data: lead, error: leadError } = await supabase
        .from('leads')
        .select('*')
        .eq('id', conv.lead_id)
        .single();
        
      if (leadError) {
        console.error('Error fetching lead:', leadError);
      } else {
        console.log('Lead status:', lead.status);
        console.log('Lead updated_at:', lead.updated_at);
        console.log('Lead sequence_stage:', lead.sequence_stage);
      }
    }
  }

  // Get messages
  const { data: messages, error: msgError } = await supabase
    .from('messages')
    .select('id, created_at, role, content, custom_data')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });
    
  if (msgError) {
    console.error('Error fetching messages:', msgError);
    process.exit(1);
  }
  
  console.log(`\nFound ${messages?.length || 0} messages:\n`);
  
  messages?.forEach((msg, idx) => {
    console.log(`[${idx}] ${msg.created_at} | ${msg.role.toUpperCase()} | ID: ${msg.id}`);
    console.log(`Content: ${msg.content?.substring(0, 100).replace(/\n/g, ' ')}...`);
    if (msg.custom_data) {
      console.log(`Custom Data: ${JSON.stringify(msg.custom_data, null, 2)}`);
    }
    console.log('---');
  });
}

analyze().catch(console.error);
