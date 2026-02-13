import { proxyActivities, executeChild } from '@temporalio/workflow';
import type { Activities } from '../activities';
import { selectRoleForEnrichment } from '../utils/personRoleUtils';
import { validateEmailWorkflow } from './validateEmailWorkflow';

// Configure activity options
const {
  leadContactGenerationActivity,
  logWorkflowExecutionActivity,
} = proxyActivities<Activities>({
  startToCloseTimeout: '5 minutes',
  retry: {
    maximumAttempts: 3,
  },
});

export interface GeneratePersonEmailOptions {
  person_id?: string;           // Person UUID from database
  external_person_id?: string | number;  // External person ID
  external_role_id?: string | number;    // Optional: match role for domain selection
  full_name: string;             // Required: Person's full name
  company_name?: string;         // Company name (also used to match role)
  company_domain?: string;       // Company domain (optional)
  company_website?: string;      // Company website (optional)
  role_title?: string;          // Person's role/title
  site_id: string;              // Required: Site ID
  userId?: string;              // Optional: User ID
  person_raw_result?: any;      // Optional: Raw person data from API
  existing_emails?: string[];  // Optional: Existing emails to validate first
}

export interface GeneratePersonEmailResult {
  success: boolean;
  validatedEmail?: string;      // First valid email found
  generatedEmails?: string[];   // All generated emails
  validatedEmails?: string[];   // All validated emails
  domain?: string;              // Domain used for generation
  error?: string;
}

/**
 * Helper function to extract domain from URL (same as ICP mining)
 */
function getDomainFromUrl(input: string): string {
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
}

/**
 * Workflow to generate and validate emails for a single person
 * Similar to ICP mining process but for one specific person
 * 
 * This workflow:
 * 1. Extracts domain from available sources
 * 2. Generates emails using leadContactGenerationActivity
 * 3. Validates each generated email
 * 4. Returns the first valid email found
 */
export async function generatePersonEmailWorkflow(
  options: GeneratePersonEmailOptions
): Promise<GeneratePersonEmailResult> {
  const { 
    person_id, 
    external_person_id,
    external_role_id,
    full_name, 
    company_name, 
    company_domain, 
    company_website,
    role_title,
    site_id, 
    userId,
    person_raw_result,
    existing_emails 
  } = options;

  const workflowId = `generate-person-email-${person_id || external_person_id || full_name?.replace(/[^a-zA-Z0-9]/g, '-') || 'unknown'}-${site_id}`;
  const startTime = Date.now();

  console.log(`🔍 Starting generate person email workflow for ${full_name}`);
  console.log(`📋 Options:`, JSON.stringify({ ...options, person_raw_result: person_raw_result ? '[object]' : undefined }, null, 2));

  // Log workflow execution start
  await logWorkflowExecutionActivity({
    workflowId,
    workflowType: 'generatePersonEmailWorkflow',
    status: 'STARTED',
    input: options,
  });

  try {
    // Validate required fields
    if (!full_name) {
      const errorMsg = 'full_name is required';
      console.error(`❌ ${errorMsg}`);
      throw new Error(errorMsg);
    }

    if (!site_id) {
      const errorMsg = 'site_id is required';
      console.error(`❌ ${errorMsg}`);
      throw new Error(errorMsg);
    }

    // Step 1: Validate existing emails first if provided
    if (existing_emails && existing_emails.length > 0) {
      console.log(`📧 Validating ${existing_emails.length} existing email(s)...`);
      for (const email of existing_emails) {
        if (!email || email.trim() === '') continue;
        
        console.log(`📧 Validating existing email: ${email}`);
        const validationResult = await executeChild(validateEmailWorkflow, {
          workflowId: `validate-email-${email.replace(/[^a-zA-Z0-9]/g, '-')}-${Date.now()}`,
          args: [{
            email,
            aggressiveMode: false,
          }],
        });

        if (validationResult.success && validationResult.data?.isValid && validationResult.data?.deliverable) {
          console.log(`✅ Existing email is valid: ${email}`);
          
          await logWorkflowExecutionActivity({
            workflowId,
            workflowType: 'generatePersonEmailWorkflow',
            status: 'COMPLETED',
            input: options,
            output: {
              success: true,
              validatedEmail: email,
              domain: undefined,
            },
          });

          return {
            success: true,
            validatedEmail: email,
            generatedEmails: [],
            validatedEmails: [email],
          };
        } else {
          const reason = validationResult.data?.result || validationResult.error?.message || 'Unknown';
          console.log(`❌ Existing email is invalid: ${email} (${reason})`);
        }
      }
    }

    // Step 2: Extract domain from available sources
    console.log(`🌐 Step 2: Extracting domain from available sources...`);
    let domain = '';

    // Priority order: person_raw_result (most reliable) > company_website > company_domain > company_name fallback
    // First, try to get domain from person_raw_result (roles organization domain)
    if (person_raw_result) {
      try {
        // Check roles for organization domain (match by company_name or external_role_id)
        if (person_raw_result.roles && Array.isArray(person_raw_result.roles)) {
          const currentRole = selectRoleForEnrichment(person_raw_result.roles, {
            company_name: company_name ?? undefined,
            external_role_id: external_role_id ?? undefined,
          }) ?? person_raw_result.roles[0];
          if (currentRole?.organization?.domain) {
            domain = getDomainFromUrl(currentRole.organization.domain);
            console.log(`📋 Using domain from person_raw_result.roles[].organization.domain: ${domain}`);
          } else if (currentRole?.organization?.website) {
            domain = getDomainFromUrl(currentRole.organization.website);
            console.log(`📋 Using domain from person_raw_result.roles[].organization.website: ${domain}`);
          }
        }
        
        // Fallback to organization.domain if roles didn't have it
        if (!domain) {
          const orgDomain = (person_raw_result?.organization?.domain ?? person_raw_result?.domain ?? '') as string;
          if (orgDomain && typeof orgDomain === 'string') {
            domain = getDomainFromUrl(orgDomain);
            console.log(`📋 Using domain from person_raw_result.organization.domain: ${domain}`);
          }
        }

        // Fallback to organization.website if still no domain
        if (!domain && person_raw_result?.organization?.website) {
          domain = getDomainFromUrl(person_raw_result.organization.website as string);
          console.log(`📋 Using domain from person_raw_result.organization.website: ${domain}`);
        }
      } catch (error) {
        console.warn(`⚠️ Error extracting domain from person_raw_result: ${error}`);
      }
    }
    
    // If no domain from person_raw_result, try company_website
    if (!domain && company_website && company_website.trim() !== '') {
      domain = getDomainFromUrl(company_website);
      console.log(`📋 Using provided company_website: ${domain}`);
    }
    
    // If still no domain, try company_domain (less reliable, may be generated from company name)
    if (!domain && company_domain && company_domain.trim() !== '') {
      domain = getDomainFromUrl(company_domain);
      console.log(`📋 Using provided company_domain: ${domain}`);
    }

    // Fallback to company_name if no domain found
    if (!domain && company_name) {
      domain = (company_name as string).toLowerCase().replace(/\s+/g, '') + '.com';
      console.log(`📋 Using fallback domain from company_name: ${domain}`);
    }

    if (!domain) {
      const errorMsg = 'No domain available for email generation. Need company_domain, company_website, or company_name.';
      console.error(`❌ ${errorMsg}`);
      
      await logWorkflowExecutionActivity({
        workflowId,
        workflowType: 'generatePersonEmailWorkflow',
        status: 'FAILED',
        input: options,
        error: errorMsg,
      });

      return {
        success: false,
        error: errorMsg,
        generatedEmails: [],
        validatedEmails: [],
      };
    }

    // Step 3: Generate emails using leadContactGenerationActivity
    console.log(`📧 Step 3: Generating emails for ${full_name} @ ${domain}...`);
    
    const context = `Name: ${full_name}\nCompany: ${company_name || 'Unknown'}\nPosition: ${role_title || 'Unknown'}\nContext: Person email generation workflow`;
    
    const generationResult = await leadContactGenerationActivity({
      name: full_name,
      domain,
      context,
      site_id,
    });

    if (!generationResult.success) {
      const errorMsg = `Email generation failed: ${generationResult.error}`;
      console.error(`❌ ${errorMsg}`);
      
      await logWorkflowExecutionActivity({
        workflowId,
        workflowType: 'generatePersonEmailWorkflow',
        status: 'FAILED',
        input: options,
        error: errorMsg,
      });

      return {
        success: false,
        error: errorMsg,
        domain,
        generatedEmails: [],
        validatedEmails: [],
      };
    }

    // Extract emails from multiple sources (primary and fallback)
    let generatedEmails: string[] = [];
    const emailSources: string[] = [];
    
    // Primary source: email_generation_analysis
    if (generationResult.email_generation_analysis && generationResult.email_generation_analysis.length > 0) {
      generatedEmails.push(...generationResult.email_generation_analysis);
      emailSources.push(`email_generation_analysis (${generationResult.email_generation_analysis.length})`);
    }
    
    // Fallback source 1: basic_patterns_generated
    if (generationResult.data?.basic_patterns_generated && Array.isArray(generationResult.data.basic_patterns_generated)) {
      const basicEmails = generationResult.data.basic_patterns_generated.filter((e: string) => e && e.trim() !== '');
      generatedEmails.push(...basicEmails);
      emailSources.push(`basic_patterns_generated (${basicEmails.length})`);
    }
    
    // Fallback source 2: fallback_emails
    if (generationResult.data?.fallback_emails && Array.isArray(generationResult.data.fallback_emails)) {
      const fallbackEmails = generationResult.data.fallback_emails.filter((e: string) => e && e.trim() !== '');
      generatedEmails.push(...fallbackEmails);
      emailSources.push(`fallback_emails (${fallbackEmails.length})`);
    }
    
    // Remove duplicates while preserving order
    const uniqueEmails = Array.from(new Set(generatedEmails.map((e: string) => e.toLowerCase().trim()))).map((lowerEmail: string) => {
      // Find original email with original case
      return generatedEmails.find((e: string) => e.toLowerCase().trim() === lowerEmail) || lowerEmail;
    });
    
    generatedEmails = uniqueEmails;
    
    console.log(`📊 Generated ${generatedEmails.length} potential email(s) from sources: ${emailSources.join(', ')}`);

    if (generatedEmails.length === 0) {
      const errorMsg = 'Email generation succeeded but no emails were generated from any source';
      console.error(`❌ ${errorMsg}`);
      
      await logWorkflowExecutionActivity({
        workflowId,
        workflowType: 'generatePersonEmailWorkflow',
        status: 'FAILED',
        input: options,
        error: errorMsg,
      });

      return {
        success: false,
        error: errorMsg,
        domain,
        generatedEmails: [],
        validatedEmails: [],
      };
    }

    // Step 4: Validate generated emails using validateEmailWorkflow
    console.log(`✅ Step 4: Validating ${generatedEmails.length} generated email(s) using validateEmailWorkflow...`);
    const validatedEmails: string[] = [];
    let validatedEmail: string | null = null;

    for (const email of generatedEmails) {
      if (!email || email.trim() === '') continue;

      console.log(`📧 Validating generated email: ${email}`);
      const validationResult = await executeChild(validateEmailWorkflow, {
        workflowId: `validate-email-${email.replace(/[^a-zA-Z0-9]/g, '-')}-${Date.now()}`,
        args: [{
          email,
          aggressiveMode: false,
        }],
      });

      if (validationResult.success && validationResult.data?.isValid && validationResult.data?.deliverable) {
        console.log(`✅ Valid email found: ${email}`);
        validatedEmails.push(email);
        if (!validatedEmail) {
          validatedEmail = email;
          // Stop after finding first valid email
          break;
        }
      } else {
        const reason = validationResult.data?.result || validationResult.error?.message || 'Unknown';
        console.log(`❌ Invalid email: ${email} (${reason})`);
      }
    }

    const executionTime = `${((Date.now() - startTime) / 1000).toFixed(2)}s`;

    if (validatedEmail) {
      console.log(`🎉 Generate person email workflow completed successfully!`);
      console.log(`📊 Summary: Valid email found: ${validatedEmail}, Time: ${executionTime}`);

      const result: GeneratePersonEmailResult = {
        success: true,
        validatedEmail,
        generatedEmails,
        validatedEmails,
        domain,
      };

      await logWorkflowExecutionActivity({
        workflowId,
        workflowType: 'generatePersonEmailWorkflow',
        status: 'COMPLETED',
        input: options,
        output: result,
      });

      return result;
    } else {
      const errorMsg = 'No valid emails found after generation and validation';
      console.error(`❌ ${errorMsg}`);

      const result: GeneratePersonEmailResult = {
        success: false,
        error: errorMsg,
        generatedEmails,
        validatedEmails,
        domain,
      };

      await logWorkflowExecutionActivity({
        workflowId,
        workflowType: 'generatePersonEmailWorkflow',
        status: 'FAILED',
        input: options,
        error: errorMsg,
        output: result,
      });

      return result;
    }

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Generate person email workflow failed: ${errorMessage}`);

    await logWorkflowExecutionActivity({
      workflowId,
      workflowType: 'generatePersonEmailWorkflow',
      status: 'FAILED',
      input: options,
      error: errorMessage,
    });

    return {
      success: false,
      error: errorMessage,
      generatedEmails: [],
      validatedEmails: [],
    };
  }
}

