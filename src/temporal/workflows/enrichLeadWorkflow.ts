import { proxyActivities, executeChild, upsertSearchAttributes } from '@temporalio/workflow';
import type { Activities } from '../activities';
import { selectRoleForEnrichment } from '../utils/personRoleUtils';
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
  upsertCompanyActivity,
  leadContactGenerationActivity,
  validateContactInformation,
  logWorkflowExecutionActivity,
  lookEmailOnIcyPeas,
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
  company_name?: string;      // Optional: target company (matches role org for domain/email lookup)
  segment_id?: string;        // Optional: segment_id for ICP parity (assigned to lead)
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
  const { linkedin_profile, person_id, site_id, userId, company_name: optionsCompanyName, segment_id } = options;
  const startTime = Date.now();
  const errors: string[] = [];
  let detailsResultData: any = null; // Store details result for later use
  let personCreatedFromDetails = false; // Persistent flag to track if person was created from details API

  const workflowId = `enrich-lead-${person_id || linkedin_profile?.replace(/[^a-zA-Z0-9]/g, '-') || 'unknown'}-${site_id}`;

  const searchAttributes: Record<string, string[]> = {
    site_id: [site_id],
  };
  if (userId) {
    searchAttributes.user_id = [userId];
  }
  upsertSearchAttributes(searchAttributes);

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
        company_name: optionsCompanyName ?? undefined,
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
    console.log(`   - Work Emails: ✅ Always checked in cascading flow`);
    console.log(`   - Personal Emails: ${needsPersonalEmails ? '✅ Needed' : '⏭️ Skip (already have)'}`);
    console.log(`   - Phone Numbers: ${needsPhoneNumbers ? '✅ Needed' : '⏭️ Skip (already have)'}`);

    // Helper function to extract domain from URL (moved up for enrichment flow)
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

    // Extract domain from available sources (moved up for enrichment flow)
    let domain = '';
    let companyWebsite = '';
    let selectedRole: any = null;
    if (person.raw_result?.roles && Array.isArray(person.raw_result.roles)) {
      selectedRole = selectRoleForEnrichment(person.raw_result.roles, {
        company_name: optionsCompanyName ?? undefined,
        external_role_id: person.external_role_id ?? undefined,
      }) ?? person.raw_result.roles[0];
    }

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

      // Priority 3: person.raw_result roles organization (selectedRole set above)
      if (!domain && selectedRole) {
        try {
          if (selectedRole?.organization?.domain) {
            domain = getDomainFromUrl(selectedRole.organization.domain);
            companyWebsite = selectedRole.organization.domain;
            console.log(`📋 Using domain from selected role organization.domain: ${domain}`);
          } else if (selectedRole?.organization?.website) {
            domain = getDomainFromUrl(selectedRole.organization.website);
            companyWebsite = selectedRole.organization.website;
            console.log(`📋 Using domain from selected role organization.website: ${domain}`);
          }
        } catch (err) {
          console.warn(`⚠️ Error extracting domain from selected role: ${err}`);
        }
      }

      if (!domain && person.raw_result) {
        try {
          
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

      // Priority 4: Fallback to company_name (selected role > options > person)
      const fallbackCompanyName = (selectedRole?.organization?.name ?? selectedRole?.organization_name)
        ?? optionsCompanyName
        ?? person.company_name;
      if (!domain && fallbackCompanyName) {
        domain = (fallbackCompanyName as string).toLowerCase().replace(/\s+/g, '') + '.com';
        console.log(`⚠️ Using fallback domain from company_name: ${domain}`);
      }
    } catch (error) {
      console.warn(`⚠️ Error extracting domain: ${error}`);
    }

    // Step 4: Call enrichment APIs sequentially (Cascading Flow)
    console.log(`📞 Step 4: Calling enrichment APIs sequentially...`);
    
    // Results containers
    let workEmails: any[] = [];
    let phoneNumbers: any[] = [];
    let personalEmails: any[] = [];

    // Cascading state
    let hasResult = false;

    // Prepare API request parameters
    const apiParams: any = {};
    if (person.external_person_id) {
      apiParams.person_id = person.external_person_id;
    }
    
    let linkedinProfileToUse = linkedin_profile;
    if (!linkedinProfileToUse && person.raw_result) {
      const rawResult = person.raw_result;
      linkedinProfileToUse = rawResult?.linkedin_info?.public_profile_url || 
                             rawResult?.person?.linkedin_info?.public_profile_url ||
                             rawResult?.linkedin_url;
    }
    if (linkedinProfileToUse) {
      apiParams.linkedin_profile = linkedinProfileToUse;
    }
    
    if (person.full_name) {
      apiParams.full_name = person.full_name;
    }
    // Use selected role's org > options.company_name > person.company_name
    const apiCompanyName = (selectedRole?.organization?.name ?? selectedRole?.organization_name)
      ?? optionsCompanyName
      ?? person.company_name;
    if (apiCompanyName) {
      apiParams.company_name = apiCompanyName;
    }

    // 1. IcyPeas Email Search
    if (!hasResult && domain && person.full_name) {
      console.log(`🧊 Cascading Step 1: Calling IcyPeas...`);
      
      // Split name for IcyPeas
      const nameParts = (person.full_name as string).trim().split(/\s+/);
      const firstname = nameParts[0];
      const lastname = nameParts.slice(1).join(' ') || undefined;

      try {
        const icypeasResult = await lookEmailOnIcyPeas({
          domainOrCompany: domain,
          firstname,
          lastname,
        });

        if (icypeasResult.success && icypeasResult.data?.email) {
          console.log(`✅ IcyPeas found email: ${icypeasResult.data.email}`);
          workEmails = [{ 
            email: icypeasResult.data.email, 
            source: 'icypeas',
            confidence: icypeasResult.data.confidence 
          }];
          hasResult = true;
        } else {
          console.log(`ℹ️ IcyPeas found no email`);
        }
      } catch (e) {
        console.warn(`⚠️ IcyPeas call failed:`, e);
      }
    }

    // 2. Personal Emails (if still no result)
    if (!hasResult && needsPersonalEmails) {
      console.log(`📧 Cascading Step 2: Calling Personal Emails Lookup...`);
      try {
        const personalEmailsResult = await callPersonContactsLookupPersonalEmailsActivity(apiParams);
        if (personalEmailsResult.success && personalEmailsResult.emails && personalEmailsResult.emails.length > 0) {
          console.log(`✅ Personal emails found: ${personalEmailsResult.emails.length}`);
          personalEmails = personalEmailsResult.emails;
          hasResult = true;
        } else {
          console.log(`ℹ️ No personal emails found`);
        }
      } catch (e) {
        console.warn(`⚠️ Personal emails call failed:`, e);
      }
    }

    // 3. Work Emails (if still no result)
    if (!hasResult) {
      console.log(`📧 Cascading Step 3: Calling Finder Work Emails...`);
      try {
        const workEmailsResult = await callPersonWorkEmailsActivity(apiParams);
        if (workEmailsResult.success && workEmailsResult.emails && workEmailsResult.emails.length > 0) {
          console.log(`✅ Work emails found: ${workEmailsResult.emails.length}`);
          workEmails = workEmailsResult.emails;
          hasResult = true;
        } else {
          console.log(`ℹ️ No work emails found`);
        }
      } catch (e) {
        console.warn(`⚠️ Work emails call failed:`, e);
      }
    }

    // 4. Work Phones (if still no result)
    if (!hasResult && needsPhoneNumbers) {
      console.log(`📞 Cascading Step 4: Calling Finder Phone Numbers...`);
      try {
        const phoneNumbersResult = await callPersonContactsLookupPhoneNumbersActivity(apiParams);
        if (phoneNumbersResult.success && phoneNumbersResult.phoneNumbers && phoneNumbersResult.phoneNumbers.length > 0) {
          console.log(`✅ Phone numbers found: ${phoneNumbersResult.phoneNumbers.length}`);
          phoneNumbers = phoneNumbersResult.phoneNumbers;
          hasResult = true;
        } else {
          console.log(`ℹ️ No phone numbers found`);
        }
      } catch (e) {
        console.warn(`⚠️ Phone numbers call failed:`, e);
      }
    }

    // Fallback: If no API returned any emails, use existing data if available
    if (workEmails.length === 0 && !hasResult) {
      const existingEmail = hasPersonEmail ? existingPersonEmails[0] : (hasLeadEmail ? existingLead.email : null);
      if (existingEmail) {
        workEmails = [{ email: existingEmail }];
        console.log(`📧 Using existing email since all APIs returned none: ${existingEmail}`);
      }
    }

    // Fallback: If no API returned any phones, use existing data if available
    if (phoneNumbers.length === 0 && !hasResult) {
      const existingPhone = hasPersonPhone ? existingPersonPhones[0] : (hasLeadPhone ? existingLead.phone : null);
      if (existingPhone) {
        phoneNumbers = [{ phone_number: existingPhone }];
      }
    }

    // Fallback: If no API returned any personal emails, use existing data if available
    if (personalEmails.length === 0 && !hasResult) {
      if (hasLeadPersonalEmail) {
        personalEmails = [{ email: existingLead.personal_email }];
      }
    }

    console.log(`📊 Enrichment results:`);
    console.log(`   - Work emails: ${workEmails.length}`);
    console.log(`   - Phone numbers: ${phoneNumbers.length}`);
    console.log(`   - Personal emails: ${personalEmails.length}`);

    // Step 5.5: ICP Mining Fallback - Generate email if no contact info found
    // Check if we need to use the fallback (no work emails, personal emails, or phone numbers)
    const needsFallback = workEmails.length === 0 && personalEmails.length === 0 && phoneNumbers.length === 0;
    
    if (needsFallback && person.full_name && (person.company_name || optionsCompanyName || detailsResultData?.companies?.[0])) {
      console.log(`🔄 No contact information found, attempting ICP mining fallback...`);
      
      // Domain extraction logic was here, now moved up

      if (domain) {
        console.log(`🌐 Extracted domain: ${domain}`);
        console.log(`🚀 Calling generatePersonEmailWorkflow as fallback...`);

        try {
          const fallbackResult = await executeChild(generatePersonEmailWorkflow, {
            workflowId: `generate-person-email-fallback-${person.id || person.external_person_id || 'unknown'}-${site_id}-${Date.now()}`,
            args: [{
              person_id: person.id,
              external_person_id: person.external_person_id,
              external_role_id: person.external_role_id,
              full_name: person.full_name,
              company_name: apiCompanyName ?? person.company_name,
              company_domain: domain,
              company_website: companyWebsite || undefined,
              role_title: selectedRole?.role_title ?? person.role_title,
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
      console.log(`⚠️ Cannot use ICP mining fallback: Missing required information (full_name: ${!!person.full_name}, company: ${!!(person.company_name || optionsCompanyName)})`);
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

    // Build notes with additional contacts and descriptions (person/org from API when available)
    const notesParts: string[] = [];
    const personDescription =
      (person.raw_result && typeof (person.raw_result as any).person_description === 'string' && (person.raw_result as any).person_description.trim() !== '')
        ? (person.raw_result as any).person_description.trim()
        : (person.raw_result && typeof (person.raw_result as any).description === 'string' && (person.raw_result as any).description.trim() !== '')
          ? (person.raw_result as any).description.trim()
          : null;
    if (personDescription) {
      notesParts.push(`Person description: ${personDescription}`);
    }
    const orgDescription =
      selectedRole?.organization &&
      typeof ((selectedRole.organization as any).organization_description ?? (selectedRole.organization as any).description) === 'string'
      ? String(((selectedRole.organization as any).organization_description ?? (selectedRole.organization as any).description)).trim()
      : null;
    if (orgDescription && orgDescription !== '') {
      notesParts.push(`Organization description: ${orgDescription}`);
    }
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

    // Resolve LinkedIn URL: options > raw_result > person.linkedin_profile
    const linkedinUrlForUpdate = linkedinProfileToUse
      || person.linkedin_profile
      || null;

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
      linkedin_profile: linkedinUrlForUpdate,
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

    // Resolve company_id: selected role org > details result (matching org) > existing lead
    let leadCompanyId: string | undefined = undefined;
    if (selectedRole?.organization) {
      const org = selectedRole.organization;
      const orgName = org.name || selectedRole.organization_name;
      if (orgName) {
        const companyResult = await upsertCompanyActivity({
          name: orgName,
          website: org.domain || org.website || null,
          linkedin_url: org.linkedin_info?.public_profile_url || null,
        });
        if (companyResult.success && companyResult.company?.id) {
          leadCompanyId = companyResult.company.id;
          console.log(`🔗 Resolved company_id from selected role: ${orgName} (${leadCompanyId})`);
        }
      }
    }
    if (!leadCompanyId) {
      leadCompanyId = existingLead?.company_id;
    }
    if (!leadCompanyId && detailsResultData?.companies?.length) {
      const orgName = selectedRole?.organization?.name ?? selectedRole?.organization_name ?? optionsCompanyName;
      const matching = orgName
        ? detailsResultData.companies.find((c: any) => c.name === orgName)
        : detailsResultData.companies[0];
      leadCompanyId = matching?.id;
    }

    let leadUpdate: any = null;
    
    // Check if we have any valid contact info from cascading steps
    const hasAnyContact = primaryWorkEmail || primaryPhone || primaryPersonalEmail;
    
    if (!hasAnyContact) {
      console.log(`⚠️ No contact info found - skipping lead creation`);
      leadUpdate = { success: true, leadId: undefined };
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
        segment_id: segment_id || undefined,
        person_emails: personEmails, // Pass updated emails to avoid DB query
        linkedin_url: linkedinUrlForUpdate || undefined,
      } as any); // Type assertion needed because Activities type is auto-generated

    if (!leadUpdate.success) {
      const errorMsg = `Failed to update/create lead: ${leadUpdate.error}`;
      console.error(`❌ ${errorMsg}`);
      errors.push(errorMsg);
      throw new Error(errorMsg);
    }

    console.log(leadUpdate.leadId ? `✅ Lead created: ${leadUpdate.leadId}` : `✅ Lead not created (no contact info)`);
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

