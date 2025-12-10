import { SupabaseClient } from '@supabase/supabase-js';

export async function fetchCompany(client: SupabaseClient, companyId: string): Promise<any> {
  console.log(`🏢 Fetching company: ${companyId}`);
  const { data, error } = await client
    .from('companies')
    .select('*')
    .eq('id', companyId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') { // No rows returned
      console.log(`⚠️  Company ${companyId} not found`);
      return null;
    }
    console.error('❌ Error fetching company:', error);
    throw new Error(`Failed to fetch company: ${error.message}`);
  }

  console.log(`✅ Successfully fetched company: ${data.name}`);
  return data;
}

export async function upsertCompany(client: SupabaseClient, companyData: any): Promise<any> {
  console.log(`🏢 Upserting company: ${companyData.name}`);
  console.log(`📝 Company data:`, JSON.stringify(companyData, null, 2));

  // If ID is provided, try to update first
  if (companyData.id) {
    const { data: updateData, error: updateError } = await client
      .from('companies')
      .update({
        ...companyData,
        updated_at: new Date().toISOString()
      })
      .eq('id', companyData.id)
      .select()
      .single();

    if (!updateError) {
      console.log(`✅ Successfully updated existing company: ${updateData.name}`);
      return updateData;
    }
    
    // If update failed and it's not a "not found" error, throw
    if (updateError.code !== 'PGRST116') {
      console.error('❌ Error updating company:', updateError);
      throw new Error(`Failed to update company: ${updateError.message}`);
    }
  }

  // If no ID provided or company not found, try to find by name first
  if (companyData.name) {
    const { data: existingCompany } = await client
      .from('companies')
      .select('*')
      .eq('name', companyData.name)
      .single();

    if (existingCompany) {
      // Update existing company found by name
      const { data: updateData, error: updateError } = await client
        .from('companies')
        .update({
          ...companyData,
          id: existingCompany.id,
          updated_at: new Date().toISOString()
        })
        .eq('id', existingCompany.id)
        .select()
        .single();

      if (updateError) {
        console.error('❌ Error updating existing company by name:', updateError);
        throw new Error(`Failed to update company: ${updateError.message}`);
      }

      console.log(`✅ Successfully updated existing company by name: ${updateData.name}`);
      return updateData;
    }
  }

  // Create new company
  const { data: insertData, error: insertError } = await client
    .from('companies')
    .insert({
      ...companyData,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .select()
    .single();

  if (insertError) {
    console.error('❌ Error creating company:', insertError);
    throw new Error(`Failed to create company: ${insertError.message}`);
  }

  console.log(`✅ Successfully created new company: ${insertData.name}`);
  return insertData;
}


