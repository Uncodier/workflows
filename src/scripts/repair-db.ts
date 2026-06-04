import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.SUPABASE_URL || 'https://rnjgeloamtszdjplmqxy.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Utility function to add delay
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function repairDB() {
  console.log('Fetching leads in contacted or qualified status...');
  
  let allLeads: any[] = [];
  let page = 0;
  let hasMore = true;

  while (hasMore) {
    const { data: leads, error: leadsError } = await supabase
      .from('leads')
      .select('id, status, site_id')
      .in('status', ['contacted', 'qualified'])
      .range(page * 1000, (page + 1) * 1000 - 1);
      
    if (leadsError) {
      console.error('Error fetching leads:', leadsError);
      return;
    }

    if (leads && leads.length > 0) {
      allLeads = [...allLeads, ...leads];
      page++;
    } else {
      hasMore = false;
    }
  }
  
  console.log(`Found ${allLeads.length} active leads. Analyzing message history...`);
  
  let fixedCount = 0;
  let errorCount = 0;
  
  // Procesar leads en lotes para mayor eficiencia
  const batchSize = 50;
  for (let i = 0; i < allLeads.length; i += batchSize) {
    const batch = allLeads.slice(i, i + batchSize);
    console.log(`Processing batch ${i / batchSize + 1} of ${Math.ceil(allLeads.length / batchSize)}...`);
    
    // Añadir pausa entre lotes para no saturar Supabase
    if (i > 0) {
      await delay(1000); // 1 segundo de pausa entre batches
    }
    
    // Reintentar hasta 3 veces si hay error de fetch
    let allMessages: any[] | null = null;
    let retries = 3;
    
    while (retries > 0) {
      try {
        const leadIds = batch.map(l => l.id);
        const { data, error: msgError } = await supabase
          .from('messages')
          .select('id, lead_id, created_at, role, custom_data')
          .in('lead_id', leadIds)
          .order('created_at', { ascending: false });
          
        if (msgError) {
          throw new Error(JSON.stringify(msgError));
        }
        allMessages = data;
        break; // Éxito
      } catch (err) {
        console.warn(`Attempt failed fetching messages, retries left: ${retries - 1}`);
        retries--;
        if (retries === 0) {
          console.error(`Skipping batch ${i / batchSize + 1} after 3 failed attempts.`);
          errorCount++;
        } else {
          await delay(3000); // Esperar 3 segundos antes de reintentar
        }
      }
    }
    
    if (!allMessages) continue; // Skip to next batch if we couldn't fetch messages
    
    // Agrupar mensajes por lead
    const messagesByLead: Record<string, any[]> = {};
    for (const msg of allMessages) {
      if (!messagesByLead[msg.lead_id]) {
        messagesByLead[msg.lead_id] = [];
      }
      messagesByLead[msg.lead_id].push(msg);
    }
    
    for (const lead of batch) {
      const messages = messagesByLead[lead.id] || [];
      if (messages.length === 0) continue;
      
      let consecutiveAssistantCount = 0;
      for (const msg of messages) {
        if (msg.role === 'assistant') {
          consecutiveAssistantCount++;
        } else {
          break; // Stop at first user message
        }
      }
    
      // If the lead has 3 or more consecutive assistant messages, they should be marked as completed/cold
      if (consecutiveAssistantCount >= 3) {
        const lastMsg = messages[0];
        const customData = lastMsg.custom_data || {};
        
        // Check if it's already marked as completed
        if (customData.sequence_stage !== 'completed') {
          console.log(`Lead ${lead.id} has ${consecutiveAssistantCount} consecutive assistant messages. Fixing...`);
          
          // Mark message sequence as completed
          const updatedCustomData = {
            ...customData,
            sequence_stage: 'completed'
          };
          
          // Intentar actualizar mensaje
          let msgUpdateRetries = 3;
          while(msgUpdateRetries > 0) {
            try {
              const { error: updateMsgError } = await supabase
                .from('messages')
                .update({ custom_data: updatedCustomData })
                .eq('id', lastMsg.id);
                
              if (updateMsgError) throw new Error(JSON.stringify(updateMsgError));
              console.log(`  - Message ${lastMsg.id} sequence_stage marked as completed`);
              break;
            } catch (err) {
               msgUpdateRetries--;
               if (msgUpdateRetries === 0) {
                 console.error(`Failed to update message ${lastMsg.id}`);
                 errorCount++;
               } else await delay(2000);
            }
          }
          
          // If status is contacted, mark as cold
          if (lead.status === 'contacted') {
            let leadUpdateRetries = 3;
            while(leadUpdateRetries > 0) {
               try {
                 const { error: updateLeadError } = await supabase
                   .from('leads')
                   .update({ status: 'cold' })
                   .eq('id', lead.id);
                   
                 if (updateLeadError) throw new Error(JSON.stringify(updateLeadError));
                 console.log(`  - Lead ${lead.id} status updated to cold`);
                 break;
               } catch(err) {
                 leadUpdateRetries--;
                 if(leadUpdateRetries === 0) {
                   console.error(`Failed to update lead ${lead.id}`);
                   errorCount++;
                 } else await delay(2000);
               }
            }
          }
          fixedCount++;
        }
      } else if (consecutiveAssistantCount > 0 && consecutiveAssistantCount < 3) {
        // For leads with 1 or 2 messages missing sequence_stage, let's fix them to 'reminder' or 'provide_value'
        const lastMsg = messages[0];
        const customData = lastMsg.custom_data || {};
        
        if (!customData.sequence_stage && customData.follow_up_type === 'lead_nurture') {
          let assignedStage = 'reminder';
          if (consecutiveAssistantCount === 2) assignedStage = 'provide_value';
          
          console.log(`Lead ${lead.id} has ${consecutiveAssistantCount} consecutive assistant messages (missing stage). Setting to ${assignedStage}...`);
          
          const updatedCustomData = {
            ...customData,
            sequence_stage: assignedStage
          };
          
          let msgUpdateRetries = 3;
          while(msgUpdateRetries > 0) {
            try {
              const { error: updateMsgError } = await supabase
                .from('messages')
                .update({ custom_data: updatedCustomData })
                .eq('id', lastMsg.id);
                
              if (updateMsgError) throw new Error(JSON.stringify(updateMsgError));
              console.log(`  - Message ${lastMsg.id} sequence_stage set to ${assignedStage}`);
              fixedCount++;
              break;
            } catch (err) {
              msgUpdateRetries--;
              if(msgUpdateRetries === 0) {
                console.error(`Failed to update message ${lastMsg.id}`);
                errorCount++;
              } else await delay(2000);
            }
          }
        }
      }
    }
  }
  
  console.log(`\nFinished! Fixed ${fixedCount} leads. Errors encountered: ${errorCount}`);
}

repairDB().catch(console.error);