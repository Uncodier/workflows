import { apiService } from '../../services/apiService';
import { getSupabaseService } from '../../services';
import { contactValues, finderLeadProfile, finderResponseError, selectFinderRole } from '../../utils/finderData';
import { upsertPersonActivity } from './personActivities';
import { upsertLeadForPersonActivity } from './leadActivities';
import { upsertFinderCompanyActivity } from './companyActivity';

// Finder API: person contacts lookup (details) - creates person, companies, and lead
export async function callPersonContactsLookupDetailsActivity(options: {
  person_id: string | number; // Required: external person_id from Finder API
  site_id?: string; // Optional: site_id for lead creation
  userId?: string; // Optional: user_id for lead creation
  company_name?: string; // Optional: target company to match role (e.g. from lead context)
}): Promise<{
  success: boolean;
  person?: any;
  companies?: any[];
  lead?: any;
  error?: string;
}> {
  try {
    const supabaseService = getSupabaseService();
    const isConnected = await supabaseService.getConnectionStatus();
    if (!isConnected) {
      return { success: false, error: 'Database not available' };
    }

    // Call API endpoint
    const requestBody: any = { person_id: options.person_id };
    if (options.site_id) requestBody.site_id = options.site_id;
    console.log(`📞 Calling person_contacts_lookup/details with person_id: ${options.person_id}`);

    const response = await apiService.post('/api/finder/person_contacts_lookup/details', requestBody);
    if (!response.success) {
      return { success: false, error: response.error?.message || 'Finder person_contacts_lookup/details failed' };
    }

    const providerError = finderResponseError(response.data);
    if (providerError) return { success: false, error: providerError };
    const personData = response.data?.data || response.data;
    if (!personData) {
      return { success: false, error: 'No data returned from API' };
    }

    console.log(`✅ Received person details data for person_id: ${personData.id}`);

    // Extract current role: match by company_name from context, or most recent start_date among is_current
    const currentRole = selectFinderRole(personData, {
      company_name: options.company_name ?? undefined,
    }) ?? personData.roles?.[0];
    const currentOrganization = currentRole?.organization;

    // Extract person data
    const personLocation = personData.location?.name || null;
    const linkedinUrl = personData.linkedin_info?.public_profile_url || null;

    // Prepare person record
    const personRecord = {
      external_person_id: personData.id,
      external_role_id: currentRole?.id || null,
      external_organization_id: currentOrganization?.id || null,
      full_name: personData.full_name || null,
      role_title: currentRole?.role_title || null,
      company_name: currentRole?.organization_name || currentOrganization?.name || null,
      start_date: currentRole?.start_date || null,
      end_date: currentRole?.end_date || null,
      is_current: currentRole?.is_current,
      location: personLocation,
      linkedin_profile: linkedinUrl,
      emails: contactValues(personData.emails, personData.work_emails, currentRole?.emails),
      personal_emails: contactValues(personData.personal_emails),
      phones: contactValues(personData.phones, personData.phone_numbers, currentRole?.phones),
      raw_result: personData,
    };

    // Create/update person
    console.log(`👤 Creating/updating person: ${personRecord.full_name}`);
    const personResult = await upsertPersonActivity(personRecord);
    if (!personResult.success) {
      return { success: false, error: `Failed to create/update person: ${personResult.error}` };
    }

    const createdPerson = personResult.person;
    console.log(`✅ Person created/updated: ${createdPerson.id}`);

    // Extract and create/update companies from all roles
    const companies: any[] = [];
    const organizationsMap = new Map<string, any>();

    // Collect unique organizations from roles
    if (personData.roles && Array.isArray(personData.roles)) {
      for (const role of personData.roles) {
        if (role.organization && !organizationsMap.has(role.organization.id?.toString() || role.organization.name)) {
          organizationsMap.set(
            role.organization.id?.toString() || role.organization.name,
            role.organization
          );
        }
      }
    }

    // Also check educations for organization data
    if (personData.educations && Array.isArray(personData.educations)) {
      for (const education of personData.educations) {
        if (education.organization && !organizationsMap.has(education.organization.id?.toString() || education.organization.name)) {
          organizationsMap.set(
            education.organization.id?.toString() || education.organization.name,
            education.organization
          );
        }
      }
    }

    // Create/update companies
    console.log(`🏢 Creating/updating ${organizationsMap.size} companies`);
    let currentCompanyId: string | undefined = undefined;
    
    for (const org of organizationsMap.values()) {
      try {
        if (org.name) {
          const companyResult = await upsertFinderCompanyActivity({ organization: org });
          if (!companyResult.success) return { success: false, error: companyResult.error };
          const company = companyResult.company;
          companies.push(company);
          console.log(`✅ Company created/updated: ${company.name} (${company.id})`);
          
          // Track the current company (from current role) for lead association
          if (currentOrganization && 
              (org.id?.toString() === currentOrganization.id?.toString() || 
               org.name === currentOrganization.name)) {
            currentCompanyId = company.id;
            console.log(`🔗 Current company identified for lead: ${company.name} (${company.id})`);
          }
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(`❌ Failed to create/update company ${org.name}: ${errorMsg}`);
        return { success: false, error: `Failed to save company ${org.name}: ${errorMsg}` };
      }
    }

    // Create/update lead if site_id is provided
    let lead: any = null;
    if (options.site_id && createdPerson && contactValues(createdPerson.emails, createdPerson.personal_emails, createdPerson.phones).length) {
      console.log(`📋 Creating/updating lead for site: ${options.site_id}`);
      
      // Extract primary email and phone if available (from person data or roles)
      // Note: The details endpoint might not include contact info, so we'll create lead without it
      // Contact enrichment can happen later via other endpoints
      
      const leadResult = await upsertLeadForPersonActivity({
        person_id: createdPerson.id,
        site_id: options.site_id,
        name: personRecord.full_name || undefined,
        email: contactValues(createdPerson.emails)[0],
        phone: contactValues(createdPerson.phones)[0],
        personal_email: contactValues(createdPerson.personal_emails)[0],
        userId: options.userId,
        company_id: currentCompanyId, // Associate lead with current company
        linkedin_url: linkedinUrl || undefined,
        profile: finderLeadProfile(createdPerson, currentRole),
      });

      if (leadResult.success) {
        lead = leadResult.lead;
        console.log(`✅ Lead created/updated: ${leadResult.leadId}`);
      } else {
        console.error(`❌ Failed to create/update lead: ${leadResult.error}`);
        return { success: false, error: `Failed to save lead: ${leadResult.error}` };
      }
    }

    return {
      success: true,
      person: createdPerson,
      companies,
      lead,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`❌ Error in callPersonContactsLookupDetailsActivity: ${message}`);
    return { success: false, error: message };
  }
}
