import { SupabaseClient } from '@supabase/supabase-js';

export async function createPaymentRecord(
  client: SupabaseClient,
  paymentData: {
    site_id: string;
    amount: number;
    credits: number;
    payment_method: string;
    status: string;
    transaction_type: string;
    details?: any;
    command_id?: string;
  }
): Promise<any> {
  console.log(`Creating payment record for site ${paymentData.site_id}`);

  // For initial_credit payments, skip insert if one already exists to avoid
  // duplicates when retrying after a partial initialization failure.
  if (paymentData.payment_method === 'initial_credit') {
    const { data: existing } = await client
      .from('payments')
      .select('id')
      .eq('site_id', paymentData.site_id)
      .eq('payment_method', 'initial_credit')
      .maybeSingle();

    if (existing) {
      console.log(`Initial payment record already exists for site ${paymentData.site_id}, skipping.`);
      return existing;
    }
  }

  const { data, error } = await client
    .from('payments')
    .insert({
      site_id: paymentData.site_id,
      amount: paymentData.amount,
      credits: paymentData.credits,
      payment_method: paymentData.payment_method,
      status: paymentData.status,
      transaction_type: paymentData.transaction_type,
      details: paymentData.details || {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      command_id: paymentData.command_id
    })
    .select()
    .single();

  if (error) {
    if (error.code === '23503' && error.message?.includes('payments_site_id_fkey')) {
      console.log(`⚠️ Site ${paymentData.site_id} no longer exists. Skipping payment record creation.`);
      return null;
    }
    console.error(`❌ Error creating payment record for site ${paymentData.site_id}:`, error);
    throw new Error(`Failed to create payment record: ${error.message}`);
  }

  console.log(`✅ Successfully created payment record for site ${paymentData.site_id}`);
  return data;
}
