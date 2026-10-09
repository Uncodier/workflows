import { supabaseServiceRole as db } from '../../lib/supabase/client';
import { apiService } from '../services/apiService';

/** Fail closed if the site's current billing balance cannot be verified. */
export async function checkIcpMiningCreditsActivity(siteId: string): Promise<boolean> {
  const { data, error } = await db.from('billing').select('credits_available').eq('site_id', siteId).maybeSingle();
  if (error || !data || typeof data.credits_available !== 'number' || !Number.isFinite(data.credits_available)) {
    throw new Error(`ICP credits unavailable: ${error?.message || 'missing or invalid billing balance'}`);
  }
  return data.credits_available > 0;
}

/** Called once by the parent mining execution, never by an individual lead. */
export async function warnIcpMiningCreditsActivity(params: { siteId: string; workflowId: string }): Promise<void> {
  const { data: site, error: siteError } = await db.from('sites').select('user_id').eq('id', params.siteId).maybeSingle();
  if (siteError || !site?.user_id) throw new Error(`ICP warning site unavailable: ${siteError?.message || 'no owner'}`);
  const { data: profile, error: profileError } = await db.from('profiles').select('email').eq('id', site.user_id).maybeSingle();
  if (profileError || !profile?.email) throw new Error(`ICP warning recipient unavailable: ${profileError?.message || 'no email'}`);
  const response = await apiService.post('/api/agents/tools/sendEmail', {
    email: profile.email, site_id: params.siteId,
    subject: 'Aviso: ICP Mining se ha detenido por falta de créditos',
    message: `ICP Mining se ha detenido porque se agotaron los créditos durante la ejecución ${params.workflowId}. Recarga los créditos antes de reintentar.`,
  });
  if (!response.success) throw new Error(`ICP credit warning failed: ${response.error?.message || 'email API error'}`);
}