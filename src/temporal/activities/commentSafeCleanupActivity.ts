import { supabaseServiceRole } from '../../lib/supabase/client';
import { cleanupFailedFollowUpActivity as cleanupLegacyFollowUp } from './leadActivities';

/** Also protects cleanup commands already queued by pre-patch approval histories. */
export async function cleanupFailedFollowUpActivity(
  request: Parameters<typeof cleanupLegacyFollowUp>[0]
): ReturnType<typeof cleanupLegacyFollowUp> {
  if (request.message_id || request.conversation_id) {
    let query = supabaseServiceRole
      .schema(process.env.NEXT_PUBLIC_APPS_TENANT_SCHEMA || process.env.NEXT_PUBLIC_SUPABASE_SCHEMA || 'public')
      .from('messages').select('id, conversations!inner(site_id)')
      .eq('conversations.site_id', request.site_id).eq('custom_data->>source', 'comment');
    // Preserve the whole conversation if any source/proposal is a comment.
    query = request.conversation_id ? query.eq('conversation_id', request.conversation_id)
      : query.eq('id', request.message_id!);
    const { data, error } = await query.limit(1);
    if (error || !Array.isArray(data)) throw new Error('Unable to verify comment-safe follow-up cleanup');
    if (data.length) return { success: true, message_deleted: false, conversation_deleted: false };
  }
  return cleanupLegacyFollowUp(request);
}