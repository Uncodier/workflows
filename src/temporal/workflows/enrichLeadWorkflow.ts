import { proxyActivities, executeChild } from '@temporalio/workflow';
import type { Activities } from '../activities';
import { generatePersonEmailWorkflow } from './generatePersonEmailWorkflow';

// Configure activity options
const {
  checkPersonByLinkedInActivity,
  checkExistingLeadForPersonActivity,
  callPersonWorkEmailsActivity,
  callPersonContactsLookupPhoneNumbersActivity,
  callPersonContactsLookupPersonalEmailsActivity,
  callPersonContactsLookupDetailsActivity,
  upsertPersonActivity,
  upsertLeadForPersonActivity,
  createSingleLead,
  leadContactGenerationActivity,
  validateContactInformation,
  logWorkflowExecutionActivity,
} = proxyActivities<Activities>({
  startToCloseTimeout: '5 minutes',
  retry: {
    maximumAttempts: 3,
  },
});

export interface EnrichLeadOptions {
  linkedin_profile?: string;  // LinkedIn profile URL (at least one required)
  person_id?: string;         // Person ID (at least one required)
  site_id: string;            // Required: Site ID
  userId?: string;            // Optional: User ID
}

export interface EnrichLeadResult {
  success: boolean;
  personId?: string;
  leadId?: string;
  enrichedData?: {
    workEmails?: Array<{
      email: string;
      email_type?: string;
      validation_status?: string;
    }>;
    personalEmails?: Array<{
      email: string;
      email_type?: string;
      validation_status?: string;
    }>;
    phoneNumbers?: Array<{
      phone_number: string;
    }>;
  };
  errors: string[];
  executionTime: string;
  completedAt: string;
}

/**
 * Workflow to enrich lead contact information
 * 
 * This workflow:
 * 1. Validates person exists (by LinkedIn profile URL or person_id)
 * 2. Validates lead exists for site_id
 * 3. Calls three Finder API endpoints for contact enrichment
 * 4. Updates/creates person record with enriched data
 * 5. Updates/creates lead record for the site
 */
export async function enrichLeadWorkflow(
  options: EnrichLeadOptions
): Promise<EnrichLeadResult> {
  const { linkedin_profile, person_id, site_id, userId } = options;
  const startTime = Date.now();
  const errors: string[] = [];
  let detailsResultData: any = null; // Store details result for later use
  let personCreatedFromDetails = false; // Persistent flag to track if person was created from details API

  const workflowId = `enrich-lead-${person_id || linkedin_profile?.replace(/[^a-zA-Z0-9]/g, '-') || 'unknown'}-${site_id}`;

  console.log(`🔍 Starting enrich lead workflow for site ${site_id}`);
  console.log(`📋 Options:`, JSON.stringify(options, null, 2));

  // Log workflow execution start
  await logWorkflowExecutionActivity({
    workflowId,
    workflowType: 'enrichLeadWorkflow',
    status: 'STARTED',
    input: options,
  });

  try {
    // Step 1: Validate input - at least one of linkedin_profile or person_id required
    if (!linkedin_profile && !person_id) {
      const errorMsg = 'At least one of linkedin_profile or person_id is required';
      console.error(`❌ ${errorMsg}`);
      errors.push(errorMsg);
      throw new Error(errorMsg);
    }

    // Step 2: Find person by LinkedIn profile or person_id
    console.log(`👤 Step 2: Finding person...`);
    let person: any = null;

    const personCheck = await checkPersonByLinkedInActivity({
      linkedin_profile,
      person_id,
    });

    if (!personCheck.success) {
      const errorMsg = `Failed to check person: ${personCheck.error}`;
      console.error(`❌ ${errorMsg}`);
      errors.push(errorMsg);
      throw new Error(errorMsg);
    }

    if (!personCheck.hasExistingPerson) {
      // Person doesn't exist - try to create it from details API
      console.log(`👤 Person not found, attempting to create from details API...`);
      
      // We need person_id (external_person_id) to call details API
      // If we only have linkedin_profile, we can't call details API
      if (!person_id) {
        const errorMsg = `Person not found and person_id is required to create person from details API. Provided: ${linkedin_profile ? 'linkedin_profile only' : 'nothing'}`;
        console.error(`❌ ${errorMsg}`);
        errors.push(errorMsg);
        throw new Error(errorMsg);
      }

      // Call details API to create person, companies, and lead
      console.log(`📞 Calling person_contacts_lookup/details with person_id: ${person_id}`);
      const detailsResult = await callPersonContactsLookupDetailsActivity({
        person_id: person_id,
        site_id: site_id,
        userId: userId,
      });

      if (!detailsResult.success) {
        const errorMsg = `Failed to create person from details API: ${detailsResult.error}`;
        console.error(`❌ ${errorMsg}`);
        errors.push(errorMsg);
        throw new Error(errorMsg);
      }

      if (!detailsResult.person) {
        const errorMsg = 'Details API succeeded but no person was created';
      console.error(`❌ ${errorMsg}`);
      errors.push(errorMsg);
      throw new Error(errorMsg);
    }

      person = detailsResult.person;
      detailsResultData = detailsResult; // Store for later use
      personCreatedFromDetails = true; // Set flag to force work emails call
      console.log(`✅ Person created from details API: ${person.id} (${person.full_name || 'Unknown'})`);
      console.log(`🏢 Companies created/updated: ${detailsResult.companies?.length || 0}`);
      if (detailsResult.lead) {
        console.log(`📋 Lead created/updated: ${detailsResult.lead.id}`);
      }
      
      // When person is created from details API, they don't have contact info yet
      // Force enrichment by ensuring person emails/phones are treated as empty
      person.emails = null;
      person.phones = null;
      console.log(`🔄 Person created from details - will enrich contact information`);
      console.log(`🚩 Flag set: personCreatedFromDetails = true (will force work emails call)`);
    } else {
    person = personCheck.existingPerson;
    console.log(`✅ Found person: ${person.id} (${person.full_name || 'Unknown'})`);
    }

    // Check what data the person already has
    const existingPersonEmails = person.emails || [];
    const existingPersonPhones = person.phones || [];
    const hasPersonEmail = Array.isArray(existingPersonEmails) && existingPersonEmails.length > 0 && existingPersonEmails[0]?.trim() !== '';
    const hasPersonPhone = Array.isArray(existingPersonPhones) && existingPersonPhones.length > 0 && existingPersonPhones[0]?.trim() !== '';

    console.log(`📋 Existing person data:`);
    console.log(`   - Emails: ${hasPersonEmail ? `✅ (${existingPersonEmails.length})` : '❌'}`);
    console.log(`   - Phones: ${hasPersonPhone ? `✅ (${existingPersonPhones.length})` : '❌'}`);

    // Step 3: Validate lead exists for site_id and get existing data
    console.log(`🔍 Step 3: Checking if lead exists for person and site...`);
    const leadCheck = await checkExistingLeadForPersonActivity({
      person_id: person.id,
      site_id,
    });

    if (!leadCheck.success) {
      const errorMsg = `Failed to check lead: ${leadCheck.error}`;
      console.error(`❌ ${errorMsg}`);
      errors.push(errorMsg);
      throw new Error(errorMsg);
    }

    const hasExistingLead = leadCheck.hasExistingLead;
    const existingLead = leadCheck.existingLead;
    console.log(`📊 Lead exists: ${hasExistingLead ? 'Yes' : 'No'}`);

    // Check what data the lead already has
    // Treat empty strings as missing (leads created from details API may have empty strings)
    const hasLeadEmail = existingLead?.email && existingLead.email.trim() !== '' && existingLead.email !== '';
    const hasLeadPersonalEmail = existingLead?.personal_email && existingLead.personal_email.trim() !== '' && existingLead.personal_email !== '';
    const hasLeadPhone = existingLead?.phone && existingLead.phone.trim() !== '' && existingLead.phone !== '';

    console.log(`📋 Existing lead data:`);
    console.log(`   - Email: ${hasLeadEmail ? '✅' : '❌'}`);
    console.log(`   - Personal Email: ${hasLeadPersonalEmail ? '✅' : '❌'}`);
    console.log(`   - Phone: ${hasLeadPhone ? '✅' : '❌'}`);

    // Determine what data we need to enrich
    // ALWAYS call work emails - no conditions
    // We need personal emails if lead doesn't have personal_email
    const needsPersonalEmails = !hasLeadPersonalEmail;
    // We need phone numbers if person doesn't have phones OR lead doesn't have phone
    const needsPhoneNumbers = !hasPersonPhone || !hasLeadPhone;

    console.log(`🔍 Enrichment needs:`);
    console.log(`   - Work Emails: ✅ Always called`);
    console.log(`   - Personal Emails: ${needsPersonalEmails ? '✅ Needed' : '⏭️ Skip (already have)'}`);
    console.log(`   - Phone Numbers: ${needsPhoneNumbers ? '✅ Needed' : '⏭️ Skip (already have)'}`);

    // Step 4: Call enrichment APIs only for missing data
    console.log(`📞 Step 4: Calling enrichment APIs for missing data...`);
    
    // Prepare API request parameters
    // For Forager API, person_id must be an integer (external_person_id), not UUID
    const apiParams: any = {};
    
    // Prefer external_person_id (integer) for Forager API, not the UUID from database
    if (person.external_person_id) {
      apiParams.person_id = person.external_person_id;
      console.log(`📋 Using external_person_id (${person.external_person_id}) for API calls`);
    }
    
    // Use linkedin_profile from options, or extract from person's raw_result
    let linkedinProfileToUse = linkedin_profile;
    if (!linkedinProfileToUse && person.raw_result) {
      const rawResult = person.raw_result;
      linkedinProfileToUse = rawResult?.linkedin_info?.public_profile_url || 
                             rawResult?.person?.linkedin_info?.public_profile_url ||
                             rawResult?.linkedin_url;
    }
    if (linkedinProfileToUse) {
      apiParams.linkedin_profile = linkedinProfileToUse;
      console.log(`📋 Using linkedin_profile for API calls`);
    }
    
    // Add additional identifiers as fallback
    if (person.full_name) {
      apiParams.full_name = person.full_name;
    }
    if (person.company_name) {
      apiParams.company_name = person.company_name;
    }
    
    // Log final API parameters (without sensitive data)
    console.log(`📋 API parameters:`, {
      person_id: apiParams.person_id ? `${apiParams.person_id} (external_person_id)` : 'none',
      linkedin_profile: apiParams.linkedin_profile ? 'provided' : 'none',
      has_full_name: !!apiParams.full_name,
      has_company_name: !!apiParams.company_name,
    });

    // Call APIs conditionally based on existing data (person and lead)
    const apiCalls: Promise<any>[] = [];
    
    // ALWAYS call work emails as a separate, visible activity
    console.log(`📧 Executing callPersonWorkEmailsActivity as separate activity...`);
    const workEmailsResult = await callPersonWorkEmailsActivity(apiParams);
    console.log(`✅ Work emails activity completed: ${workEmailsResult.success ? 'success' : 'failed'}`);
    if (workEmailsResult.success) {
      console.log(`📊 Work emails found: ${workEmailsResult.emails?.length || 0}`);
    } else {
      console.log(`⚠️ Work emails failed: ${workEmailsResult.error}`);
    }

    if (needsPhoneNumbers) {
      console.log(`📞 Calling phone numbers API (missing in person or lead)...`);
      apiCalls.push(callPersonContactsLookupPhoneNumbersActivity(apiParams).then(result => ({ type: 'phoneNumbers', result })));
    } else {
      console.log(`⏭️ Skipping phone numbers API (already have in person and lead)`);
    }

    if (needsPersonalEmails) {
      console.log(`📧 Calling personal emails API (missing in lead)...`);
      apiCalls.push(callPersonContactsLookupPersonalEmailsActivity(apiParams).then(result => ({ type: 'personalEmails', result })));
    } else {
      console.log(`⏭️ Skipping personal emails API (already have in lead)`);
    }

    // Execute API calls in parallel (if any)
    const apiResults = await Promise.all(apiCalls);

    // Process results
    let phoneNumbersResult: any = { success: true, phoneNumbers: [] };
    let personalEmailsResult: any = { success: true, emails: [] };

    apiResults.forEach(({ type, result }) => {
      if (type === 'phoneNumbers') {
        phoneNumbersResult = result;
      } else if (type === 'personalEmails') {
        personalEmailsResult = result;
      }
    });

    // Process results - always use API result for work emails
    let workEmails: any[] = [];
    workEmails = workEmailsResult.success ? (workEmailsResult.emails || []) : [];
    
    // If API returned no emails but we have existing emails, keep them
    if (workEmails.length === 0) {
      const existingEmail = hasPersonEmail ? existingPersonEmails[0] : (hasLeadEmail ? existingLead.email : null);
      if (existingEmail) {
        workEmails = [{ email: existingEmail }];
        console.log(`📧 Using existing email since API returned none: ${existingEmail}`);
      }
    }
    
    let phoneNumbers: any[] = [];
    if (!needsPhoneNumbers) {
      // Use existing data - prefer person phone, fallback to lead phone
      const existingPhone = hasPersonPhone ? existingPersonPhones[0] : (hasLeadPhone ? existingLead.phone : null);
      if (existingPhone) {
        phoneNumbers = [{ phone_number: existingPhone }];
      }
    } else {
      phoneNumbers = phoneNumbersResult.success ? (phoneNumbersResult.phoneNumbers || []) : [];
    }
    
    let personalEmails: any[] = [];
    if (!needsPersonalEmails) {
      // Use existing personal email from lead
      if (hasLeadPersonalEmail) {
        personalEmails = [{ email: existingLead.personal_email }];
      }
    } else {
      personalEmails = personalEmailsResult.success ? (personalEmailsResult.emails || []) : [];
    }

    // Log work emails result
    if (!workEmailsResult.success) {
      console.warn(`⚠️ Work emails API failed: ${workEmailsResult.error} (continuing with existing data if available)`);
      // Don't add to errors - we'll use existing data if available
    }
    if (needsPhoneNumbers && !phoneNumbersResult.success) {
      errors.push(`Phone numbers API failed: ${phoneNumbersResult.error}`);
    }
    if (needsPersonalEmails && !personalEmailsResult.success) {
      errors.push(`Personal emails API failed: ${personalEmailsResult.error}`);
    }

    console.log(`📊 Enrichment results:`);
    console.log(`   - Work emails: ${workEmails.length}`);
    console.log(`   - Phone numbers: ${phoneNumbers.length}`);
    console.log(`   - Personal emails: ${personalEmails.length}`);

    // Step 5.5: ICP Mining Fallback - Generate email if no contact info found
    // Check if we need to use the fallback (no work emails, personal emails, or phone numbers)
    const needsFallback = workEmails.length === 0 && personalEmails.length === 0 && phoneNumbers.length === 0;
    
    if (needsFallback && person.full_name && (person.company_name || detailsResultData?.companies?.[0])) {
      console.log(`🔄 No contact information found, attempting ICP mining fallback...`);
      
      // Helper function to extract domain from URL (same as ICP mining)
      const getDomainFromUrl = (input: string): string => {
        try {
          const sanitized = String(input).trim();
          return sanitized
            .replace(/^https?:\/\//i, '')
            .replace(/^www\./i, '')
            .split('/')[0]
            .split('?')[0]
            .split('#')[0];
        } catch {
          return '';
        }
      };

      // Extract domain from available sources (same priority as ICP mining)
      let domain = '';
      let companyWebsite = '';

      try {
        // Priority 1: detailsResultData companies
        if (detailsResultData?.companies?.[0]) {
          const company = detailsResultData.companies[0];
          if (company.domain) {
            domain = getDomainFromUrl(company.domain);
            console.log(`📋 Using domain from detailsResultData.companies[0].domain: ${domain}`);
          } else if (company.website) {
            domain = getDomainFromUrl(company.website);
            companyWebsite = company.website;
            console.log(`📋 Using domain from detailsResultData.companies[0].website: ${domain}`);
          }
        }

        // Priority 2: existingLead web/website
        if (!domain && existingLead) {
          if (existingLead.web) {
            domain = getDomainFromUrl(existingLead.web);
            companyWebsite = existingLead.web;
            console.log(`📋 Using domain from existingLead.web: ${domain}`);
          } else if (existingLead.website) {
            domain = getDomainFromUrl(existingLead.website);
            companyWebsite = existingLead.website;
            console.log(`📋 Using domain from existingLead.website: ${domain}`);
          }
        }

        // Priority 3: person.raw_result roles organization (most reliable source)
        if (!domain && person.raw_result) {
          try {
            // Check roles for organization domain (most reliable source)
            if (person.raw_result.roles && Array.isArray(person.raw_result.roles)) {
              // Get current role (is_current: true) or first role
              const currentRole = person.raw_result.roles.find((r: any) => r.is_current === true) || person.raw_result.roles[0];
              if (currentRole?.organization?.domain) {
                domain = getDomainFromUrl(currentRole.organization.domain);
                companyWebsite = currentRole.organization.domain;
                console.log(`📋 Using domain from person.raw_result.roles[].organization.domain: ${domain}`);
              } else if (currentRole?.organization?.website) {
                domain = getDomainFromUrl(currentRole.organization.website);
                companyWebsite = currentRole.organization.website;
                console.log(`📋 Using domain from person.raw_result.roles[].organization.website: ${domain}`);
              }
            }
            
            // Fallback to organization.domain if roles didn't have it
            if (!domain) {
              const orgDomain = (person.raw_result?.organization?.domain ?? person.raw_result?.domain ?? '') as string;
              if (orgDomain && typeof orgDomain === 'string') {
                domain = getDomainFromUrl(orgDomain);
                console.log(`📋 Using domain from person.raw_result.organization.domain: ${domain}`);
              }
            }

            // Fallback to organization.website if still no domain
            if (!domain && person.raw_result?.organization?.website) {
              domain = getDomainFromUrl(person.raw_result.organization.website as string);
              companyWebsite = person.raw_result.organization.website;
              console.log(`📋 Using domain from person.raw_result.organization.website: ${domain}`);
            }
          } catch (error) {
            console.warn(`⚠️ Error extracting domain from person.raw_result: ${error}`);
          }
        }

        // Priority 4: Fallback to company_name (only if no real domain found)
        // NOTE: This generates a domain from company name, which may not be accurate
        // Only use as last resort
        if (!domain && person.company_name) {
          domain = (person.company_name as string).toLowerCase().replace(/\s+/g, '') + '.com';
          console.log(`⚠️ Using fallback domain from company_name (may not be accurate): ${domain}`);
        }
      } catch (error) {
        console.warn(`⚠️ Error extracting domain: ${error}`);
      }

      if (domain) {
        console.log(`🌐 Extracted domain: ${domain}`);
        console.log(`🚀 Calling generatePersonEmailWorkflow as fallback...`);

        try {
          const fallbackResult = await executeChild(generatePersonEmailWorkflow, {
            workflowId: `generate-person-email-fallback-${person.id || person.external_person_id || 'unknown'}-${site_id}-${Date.now()}`,
            args: [{
              person_id: person.id,
              external_person_id: person.external_person_id,
              full_name: person.full_name,
              company_name: person.company_name,
              company_domain: domain,
              company_website: companyWebsite || undefined,
              role_title: person.role_title,
              site_id,
              userId,
              person_raw_result: person.raw_result,
            }],
          });

          if (fallbackResult.success && fallbackResult.validatedEmail) {
            console.log(`✅ ICP mining fallback succeeded! Found valid email: ${fallbackResult.validatedEmail}`);
            
            // Add the validated email to workEmails
            workEmails = [{ email: fallbackResult.validatedEmail }];
            console.log(`📧 Updated workEmails with fallback email`);
          } else {
            console.log(`⚠️ ICP mining fallback did not find a valid email: ${fallbackResult.error || 'No valid email found'}`);
          }
        } catch (fallbackError) {
          const errorMsg = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
          console.error(`❌ ICP mining fallback failed: ${errorMsg}`);
          // Continue with normal flow - don't throw, just log the error
        }
      } else {
        console.log(`⚠️ Cannot use ICP mining fallback: No domain available for email generation`);
      }
    } else if (needsFallback) {
      console.log(`⚠️ Cannot use ICP mining fallback: Missing required information (full_name: ${!!person.full_name}, company_name: ${!!person.company_name})`);
    }

    // Step 6: Process and extract contact data
    console.log(`📝 Step 6: Processing contact data...`);

    // Extract first items for primary fields
    // Prefer newly fetched work emails from API, then existing data
    const primaryWorkEmail = workEmails.length > 0 
      ? (typeof workEmails[0] === 'string' ? workEmails[0] : workEmails[0].email)
      : (hasLeadEmail 
          ? existingLead.email 
          : (hasPersonEmail ? existingPersonEmails[0] : null));
    
    const primaryPhone = hasLeadPhone 
      ? existingLead.phone 
      : (hasPersonPhone 
          ? existingPersonPhones[0] 
          : (phoneNumbers.length > 0 ? (typeof phoneNumbers[0] === 'string' ? phoneNumbers[0] : phoneNumbers[0].phone_number) : null));
    
    const primaryPersonalEmail = hasLeadPersonalEmail 
      ? existingLead.personal_email 
      : (personalEmails.length > 0 ? (typeof personalEmails[0] === 'string' ? personalEmails[0] : personalEmails[0].email) : null);

    // Extract additional contacts for notes
    const additionalWorkEmails = workEmails.slice(1).map((e: any) => typeof e === 'string' ? e : e.email);
    const additionalPhones = phoneNumbers.slice(1).map((p: any) => typeof p === 'string' ? p : p.phone_number);
    const additionalPersonalEmails = personalEmails.slice(1).map((e: any) => typeof e === 'string' ? e : e.email);

    // Build notes with additional contacts
    const notesParts: string[] = [];
    if (additionalWorkEmails.length > 0) {
      notesParts.push(`Additional work emails: ${additionalWorkEmails.join(', ')}`);
    }
    if (additionalPhones.length > 0) {
      notesParts.push(`Additional phone numbers: ${additionalPhones.join(', ')}`);
    }
    if (additionalPersonalEmails.length > 0) {
      notesParts.push(`Additional personal emails: ${additionalPersonalEmails.join(', ')}`);
    }
    const additionalNotes = notesParts.join('\n');

    // Step 6: Update person with enriched data IMMEDIATELY (before lead validation)
    console.log(`👤 Step 6: Updating person with enriched data...`);

    // Prepare person emails and phones arrays
    const personEmails: string[] = [];
    if (primaryWorkEmail) personEmails.push(primaryWorkEmail);
    if (primaryPersonalEmail && primaryPersonalEmail !== primaryWorkEmail) {
      personEmails.push(primaryPersonalEmail);
    }
    // Add additional emails
    additionalWorkEmails.forEach((email: string) => {
      if (!personEmails.includes(email)) personEmails.push(email);
    });
    additionalPersonalEmails.forEach((email: string) => {
      if (!personEmails.includes(email)) personEmails.push(email);
    });

    const personPhones: string[] = [];
    if (primaryPhone) personPhones.push(primaryPhone);
    additionalPhones.forEach((phone: string) => {
      if (!personPhones.includes(phone)) personPhones.push(phone);
    });

    // Update person IMMEDIATELY with enriched data
    const personUpdate = await upsertPersonActivity({
      external_person_id: person.external_person_id,
      external_role_id: person.external_role_id,
      external_organization_id: person.external_organization_id,
      full_name: person.full_name,
      role_title: person.role_title,
      company_name: person.company_name,
      start_date: person.start_date,
      end_date: person.end_date,
      is_current: person.is_current,
      location: person.location,
      emails: personEmails.length > 0 ? personEmails : null,
      phones: personPhones.length > 0 ? personPhones : null,
      raw_result: person.raw_result,
    });

    if (!personUpdate.success) {
      const errorMsg = `Failed to update person: ${personUpdate.error}`;
      console.error(`❌ ${errorMsg}`);
      errors.push(errorMsg);
      throw new Error(errorMsg);
    }

    // Update person object with updated data (so validation can use it)
    person = personUpdate.person;
    console.log(`✅ Person updated successfully with ${personEmails.length} email(s) and ${personPhones.length} phone(s)`);

    // Step 7: Update/Create lead with enriched data
    console.log(`📋 Step 7: Updating/creating lead...`);

    // Get company_id from existing lead if available, or from details result
    const leadCompanyId = existingLead?.company_id || (detailsResultData?.companies?.[0]?.id);

    let leadUpdate: any = null;
    
    // If work emails failed and we don't have email/phone, use createSingleLead as fallback
    if (!workEmailsResult.success && !primaryWorkEmail && !primaryPhone) {
      console.log(`⚠️ Work emails API failed and no contact info available, using createSingleLead fallback...`);
      
      const leadData = {
        name: person.full_name || 'Unknown',
        email: undefined, // No email available
        company_name: person.company_name || undefined,
        position: person.role_title || undefined,
        telephone: undefined, // No phone available
        web: undefined,
        address: {},
        social_networks: {
          linkedin_id: person.external_person_id || undefined,
        },
        company: person.company_name ? {
          name: person.company_name,
        } : {},
        metadata: {
          person_id: person.id,
          external_person_id: person.external_person_id,
          external_role_id: person.external_role_id,
          source: 'enrich_lead_workflow',
          enrichment_date: new Date().toISOString(),
          work_emails_api_failed: true,
        },
        person_id: person.id,
        origin: 'lead_enrichment_workflow', // Set origin for fallback flow
      };

      const createResult = await createSingleLead(leadData, site_id, userId, leadCompanyId);
      
      if (createResult.success) {
        leadUpdate = { success: true, leadId: createResult.leadId };
        console.log(`✅ Lead created using createSingleLead fallback: ${createResult.leadId}`);
      } else {
        const errorMsg = `Failed to create lead with createSingleLead fallback: ${createResult.error}`;
        console.error(`❌ ${errorMsg}`);
        errors.push(errorMsg);
        throw new Error(errorMsg);
      }
    } else {
      // Normal flow: use upsertLeadForPersonActivity
      // Pass person_emails to avoid database query (person was just updated)
      leadUpdate = await upsertLeadForPersonActivity({
        person_id: person.id,
        site_id,
        email: primaryWorkEmail || undefined,
        phone: primaryPhone || undefined,
        personal_email: primaryPersonalEmail || undefined,
        name: person.full_name || undefined,
        notes: additionalNotes || undefined,
        userId,
        company_id: leadCompanyId,
        person_emails: personEmails, // Pass updated emails to avoid DB query
      } as any); // Type assertion needed because Activities type is auto-generated

    if (!leadUpdate.success) {
      const errorMsg = `Failed to update/create lead: ${leadUpdate.error}`;
      console.error(`❌ ${errorMsg}`);
      errors.push(errorMsg);
      throw new Error(errorMsg);
    }

    console.log(`✅ Lead ${leadUpdate.leadId ? 'created' : 'updated'} successfully`);
    }

    const executionTime = `${((Date.now() - startTime) / 1000).toFixed(2)}s`;
    const result: EnrichLeadResult = {
      success: true,
      personId: person.id,
      leadId: leadUpdate.leadId,
      enrichedData: {
        workEmails: workEmails.map((e: any) => typeof e === 'string' ? { email: e } : e),
        personalEmails: personalEmails.map((e: any) => typeof e === 'string' ? { email: e } : e),
        phoneNumbers: phoneNumbers.map((p: any) => typeof p === 'string' ? { phone_number: p } : p),
      },
      errors,
      executionTime,
      completedAt: new Date().toISOString(),
    };

    console.log(`🎉 Enrich lead workflow completed successfully!`);
    console.log(`📊 Summary: Person ${person.id}, Lead ${leadUpdate.leadId}, Time: ${executionTime}`);

    // Log workflow execution completion
    await logWorkflowExecutionActivity({
      workflowId,
      workflowType: 'enrichLeadWorkflow',
      status: 'COMPLETED',
      input: options,
      output: result,
    });

    return result;

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Enrich lead workflow failed: ${errorMessage}`);

    const executionTime = `${((Date.now() - startTime) / 1000).toFixed(2)}s`;
    const result: EnrichLeadResult = {
      success: false,
      errors: [...errors, errorMessage],
      executionTime,
      completedAt: new Date().toISOString(),
    };

    // Log workflow execution failure
    await logWorkflowExecutionActivity({
      workflowId,
      workflowType: 'enrichLeadWorkflow',
      status: 'FAILED',
      input: options,
      error: errorMessage,
    });

    return result;
  }
}

