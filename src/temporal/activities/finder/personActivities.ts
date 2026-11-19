import { getSupabaseService } from '../../services';
import { matchesSelectedPerson, selectedIdentityColumn } from '../../utils/selectedFinderIdentity';
import { personPersistencePayload } from '../../utils/finderData';

// Check if person already exists
export async function checkExistingPersonActivity(options: {
  external_person_id?: string | number;
  external_role_id?: string | number;
  full_name?: string;
  company_name?: string;
  site_id?: string;
}): Promise<{
  success: boolean;
  hasExistingPerson: boolean;
  existingPerson?: any;
  error?: string;
}> {
  try {
    const supabaseService = getSupabaseService();
    const isConnected = await supabaseService.getConnectionStatus();
    if (!isConnected) return { success: false, hasExistingPerson: false, error: 'Database not available' };
    const { supabaseServiceRole } = await import('../../../lib/supabase/client');

    let query = supabaseServiceRole
      .from('persons')
      .select('id, full_name, company_name, external_person_id, external_role_id, emails, phones, created_at, updated_at');

    // Try to find by external IDs first (most reliable)
    if (options.external_person_id && options.external_role_id) {
      query = query
        .eq('external_person_id', options.external_person_id)
        .eq('external_role_id', options.external_role_id);
    } else if (options.external_person_id) {
      query = query.eq('external_person_id', options.external_person_id);
    } else if (options.full_name && options.company_name) {
      // Fallback to name and company match
      query = query
        .eq('full_name', options.full_name)
        .eq('company_name', options.company_name);
    } else {
      return { success: true, hasExistingPerson: false };
    }

    const { data: existingPerson, error } = await query
      .limit(1)
      .maybeSingle();

    if (error) return { success: false, hasExistingPerson: false, error: error.message };
    
    const hasExistingPerson = !!existingPerson;
    return { 
      success: true, 
      hasExistingPerson, 
      existingPerson: hasExistingPerson ? existingPerson : undefined 
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, hasExistingPerson: false, error: message };
  }
}

// Check person by LinkedIn profile URL or person_id
export async function checkPersonByLinkedInActivity(options: {
  linkedin_profile?: string;
  person_id?: string;
  site_id?: string;
}): Promise<{
  success: boolean;
  hasExistingPerson: boolean;
  existingPerson?: any;
  error?: string;
}> {
  try {
    const supabaseService = getSupabaseService();
    const isConnected = await supabaseService.getConnectionStatus();
    if (!isConnected) return { success: false, hasExistingPerson: false, error: 'Database not available' };
    const { supabaseServiceRole } = await import('../../../lib/supabase/client');

    // If person_id is provided, check if it's a UUID or external_person_id
    if (options.person_id) {
      // Check if person_id is a valid UUID format
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const isUUID = uuidRegex.test(options.person_id);
      
      let person: any = null;
      let error: any = null;
      
      if (isUUID) {
        // Search by UUID (id field)
        const result = await supabaseServiceRole
          .from('persons')
          .select('*')
          .eq('id', options.person_id)
          .maybeSingle();
        person = result.data;
        error = result.error;
      } else {
        // Search by external_person_id (numeric string)
        // Note: There might be multiple persons with same external_person_id but different external_role_id
        // We'll get the first one and log if there are multiple
        const result = await supabaseServiceRole
          .from('persons')
          .select('*')
          .eq('external_person_id', options.person_id)
          .order('created_at', { ascending: false }) // Get the most recent one
          .limit(1)
          .maybeSingle();
        person = result.data;
        error = result.error;
        
        // Check if there are multiple matches (for logging)
        if (!error && person) {
          const countResult = await supabaseServiceRole
            .from('persons')
            .select('id', { count: 'exact', head: true })
            .eq('external_person_id', options.person_id);
          
          if (countResult.count && countResult.count > 1) {
            console.log(`⚠️ Found ${countResult.count} persons with external_person_id ${options.person_id}, using the most recent one`);
          }
        }
      }

      if (error) return { success: false, hasExistingPerson: false, error: error.message };
      
      return { 
        success: true, 
        hasExistingPerson: !!person, 
        existingPerson: person || undefined 
      };
    }

    // If linkedin_profile is provided, search in raw_result
    if (options.linkedin_profile) {
      // Fetch persons and filter in memory since JSONB queries can be complex
      // We'll fetch a reasonable batch and filter
      const { data: allPersons, error: fetchError } = await supabaseServiceRole
        .from('persons')
        .select('*')
        .limit(1000); // Reasonable limit for search

      if (fetchError) {
        console.error('❌ Error fetching persons for LinkedIn search:', fetchError);
        return { success: false, hasExistingPerson: false, error: fetchError.message };
      }

      // Filter in memory to find matching LinkedIn URL
      const matchingPerson = allPersons?.find((p: any) => {
        const rawResult = p.raw_result;
        if (!rawResult || !options.linkedin_profile) return false;
        
        // Check multiple possible paths for LinkedIn URL
        const linkedinUrl1 = rawResult?.linkedin_info?.public_profile_url;
        const linkedinUrl2 = rawResult?.person?.linkedin_info?.public_profile_url;
        const linkedinUrl3 = rawResult?.linkedin_url;
        
        const normalizedLinkedIn = options.linkedin_profile.trim();
        
        return linkedinUrl1 === normalizedLinkedIn || 
               linkedinUrl2 === normalizedLinkedIn || 
               linkedinUrl3 === normalizedLinkedIn;
      });

      return { 
        success: true, 
        hasExistingPerson: !!matchingPerson, 
        existingPerson: matchingPerson || undefined 
      };
    }

    return { success: true, hasExistingPerson: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, hasExistingPerson: false, error: message };
  }
}

// Upsert person into persons table
export async function upsertPersonActivity(person: {
  id?: string;
  selected_person_id?: string; // Exact provider identity guard, not a local UUID or a database column.
  role_query_id?: string;
  external_person_id?: number | string | null;
  external_role_id?: number | string | null;
  external_organization_id?: number | string | null;
  full_name?: string | null;
  role_title?: string | null;
  company_name?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  is_current?: boolean | null;
  location?: string | null;
  linkedin_profile?: string | null;
  emails?: any | null;
  personal_emails?: any | null;
  phones?: any | null;
  raw_result: any;
}): Promise<{ success: boolean; person?: any; error?: string }> {
  try {
    const supabaseService = getSupabaseService();
    const isConnected = await supabaseService.getConnectionStatus();
    if (!isConnected) return { success: false, error: 'Database not available' };
    const { supabaseServiceRole } = await import('../../../lib/supabase/client');

    // Reuse the known local row first. Nullable role IDs must not create duplicates.
    let existing: any = null;
    const selectedId = person.selected_person_id;
    const selectedColumn = selectedId === undefined ? undefined : selectedIdentityColumn(selectedId);
    if (person.id || person.external_person_id != null || selectedColumn) {
      let query = supabaseServiceRole.from('persons').select('*');
      if (selectedColumn) query = query.eq(selectedColumn, selectedId!);
      if (person.id) query = query.eq('id', person.id);
      else {
        if (!selectedColumn) query = query.eq('external_person_id', person.external_person_id!);
        if (person.external_role_id != null) query = query.eq('external_role_id', person.external_role_id);
        else query = query.order('created_at', { ascending: false }).limit(1);
      }
      const { data: found, error } = await query.maybeSingle();
      if (error) return { success: false, error: error.message };
      if (person.id && !found) return { success: false, error: 'Person to update was not found' };
      existing = found || null;
    }
    if (selectedId !== undefined && (!matchesSelectedPerson(person.raw_result, selectedId)
      || (existing?.raw_result && !matchesSelectedPerson(existing.raw_result, selectedId)))) {
      throw new Error('Conflicting selected Finder person evidence');
    }

    const payload = {
      ...personPersistencePayload(existing, person),
      updated_at: new Date().toISOString(),
      ...(existing ? {} : { created_at: new Date().toISOString() }),
    } as any;

    // Never rewrite a provider identity on update. PostgREST's JSON decoding
    // may round a BIGINT on return; the exact SQL filter above is the evidence.
    if (selectedColumn) {
      delete payload.external_person_id;
      if (!existing) payload[selectedColumn] = selectedId;
    }

    let resultRow: any;
    if (existing) {
      let update = supabaseServiceRole.from('persons').update(payload).eq('id', existing.id);
      if (selectedColumn) update = update.eq(selectedColumn, selectedId!);
      const { data, error } = await update.select().single();
      if (error) return { success: false, error: error.message };
      resultRow = data;
    } else {
      const { data, error } = await supabaseServiceRole
        .from('persons')
        .insert(payload)
        .select()
        .single();
      if (error) return { success: false, error: error.message };
      resultRow = data;
    }

    if (!resultRow?.id) return { success: false, error: 'Person save returned no row' };
    return { success: true, person: resultRow };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

// Update person emails field
export async function updatePersonEmailsActivity(options: { person_id: string; emails: string[] }): Promise<{ success: boolean; error?: string }> {
  const result = await upsertPersonActivity({ id: options.person_id, emails: options.emails, raw_result: {} });
  return { success: result.success, ...(result.error ? { error: result.error } : {}) };
}
