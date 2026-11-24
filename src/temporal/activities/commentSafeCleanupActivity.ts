import { supabaseServiceRole } from '../../lib/supabase/client';
import { CHAT_INTERVENTION } from '../utils/dispatchOwner';
import { cleanupFailedFollowUpActivity as cleanupLegacyFollowUp } from './leadActivities';

/** Also protects cleanup commands already queued by pre-patch approval histories. */
export async function cleanupFailedFollowUpActivity(
  request: Parameters<typeof cleanupLegacyFollowUp>[0]
): ReturnType<typeof cleanupLegacyFollowUp> {
  if (request.message_id || request.conversation_id) {
    let query = supabaseServiceRole
      .schema(process.env.NEXT_PUBLIC_APPS_TENANT_SCHEMA || process.env.NEXT_PUBLIC_SUPABASE_SCHEMA || 'public')
      .from('messages').select('id, conversations!inner(site_id)')
      .eq('conversations.site_id', request.site_id)
      .or(`custom_data->>dispatch_owner.eq.${CHAT_INTERVENTION},custom_data->>source.eq.comment,custom_data->>response_format.eq.audio,custom_data->audio_delivery.not.is.null`);
    // Preserve comments and durable audio receipts/cache, even for old queued cleanup.
    query = request.conversation_id ? query.eq('conversation_id', request.conversation_id)
      : query.eq('id', request.message_id!);
    const { data, error } = await query.limit(1);
    if (error || !Array.isArray(data)) throw new Error('Unable to verify comment-safe follow-up cleanup');
    if (data.length) return { success: true, message_deleted: false, conversation_deleted: false };
  }
  return cleanupLegacyFollowUp(request);
}