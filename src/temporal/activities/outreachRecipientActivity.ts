import { hasOutreachRecipient } from '../utils/outreachRecipients';

export async function getReachableOutreachChannels(siteId: string, lead: any, channels: string[]): Promise<string[]> {
  let conversations: any[] = [];
  const externalChannels = channels.filter(channel => !['email', 'whatsapp', 'sms', 'voice'].includes(channel));
  if (externalChannels.length) {
    const { supabaseServiceRole } = await import('../../lib/supabase/client');
    for (let offset = 0; ; offset += 100) {
      const { data, error } = await supabaseServiceRole.from('conversations').select('id, site_id, lead_id, channel, custom_data')
        .eq('site_id', siteId).eq('lead_id', lead.id).in('channel', externalChannels)
        .order('id').range(offset, offset + 99);
      if (error) throw new Error(`Outreach conversation identities unavailable: ${error.message}`);
      conversations.push(...(data || []));
      if (!data || data.length < 100) break;
    }
  }
  return channels.filter(channel => hasOutreachRecipient(lead, channel, conversations, siteId));
}