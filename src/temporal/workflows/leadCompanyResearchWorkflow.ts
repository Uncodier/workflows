import { proxyActivities, startChild, ParentClosePolicy, upsertSearchAttributes } from '@temporalio/workflow';
import type { Activities } from '../activities';
import { deepResearchWorkflow, type DeepResearchOptions } from './deepResearchWorkflow';

// Define the activity interface and options
const { 
  logWorkflowExecutionActivity,
  saveCronStatusActivity,
  getSiteActivity,
  getLeadActivity,
  updateLeadActivity,
  upsertCompanyActivity,
} = proxyActivities<Activities>({
  startToCloseTimeout: '5 minutes',
  retry: {
    maximumAttempts: 3,
  },
});

export interface LeadCompanyResearchOptions {
  lead_id: string;
  site_id: string;
  website: string; // Company website URL
  userId?: string;
  additionalData?: any;
}

export interface LeadCompanyResearchResult {
  success: boolean;
  leadId: string;
  siteId: string;
  website: string;
  siteName?: string;
  siteUrl?: string;
  companyInfo?: {
    summary: string;
    services: string[];
    clients: string[];
  };
  errors: string[];
  executionTime: string;
  completedAt: string;
}

/**
 * Formats company information for lead notes
 */
function formatCompanyInfoForNotes(website: string, companyInfo: any): string {
  const timestamp = new Date().toISOString();
  
  let formattedNotes = `=== Company Research (from website) ===\n`;
  formattedNotes += `Website: ${website}\n`;
  formattedNotes += `Date: ${timestamp}\n\n`;
  
  // Extract summary
  const summary = companyInfo.summary || companyInfo.company_summary || companyInfo.overview || '';
  if (summary) {
    formattedNotes += `COMPANY SUMMARY:\n${summary}\n\n`;
  }
  
  // Extract services
  const services = companyInfo.services || companyInfo.products_services || [];
  if (services && services.length > 0) {
    formattedNotes += `SERVICES/PRODUCTS:\n`;
    services.forEach((service: string) => {
      formattedNotes += `- ${service}\n`;
    });
    formattedNotes += `\n`;
  }
  
  // Extract clients
  const clients = companyInfo.clients || companyInfo.notable_clients || [];
  if (clients && clients.length > 0) {
    formattedNotes += `NOTABLE CLIENTS:\n`;
    clients.forEach((client: string) => {
      formattedNotes += `- ${client}\n`;
    });
    formattedNotes += `\n`;
  }
  
  return formattedNotes;
}

/**
 * Workflow to execute company website research for leads
 * 
 * This workflow:
 * 1. Analyzes the company website to extract key information
 * 2. Saves company summary, services, and clients to lead notes
 * 3. Updates company.description if company exists
 * 
 * @param options - Configuration options for company research
 */
export async function leadCompanyResearchWorkflow(
  options: LeadCompanyResearchOptions
): Promise<LeadCompanyResearchResult> {
  const { lead_id, site_id, website } = options;
  
  if (!lead_id) {
    throw new Error('No lead ID provided');
  }
  
  if (!site_id) {
    throw new Error('No site ID provided');
  }
  
  if (!website) {
    throw new Error('No website URL provided');
  }

  const searchAttributes: Record<string, string[]> = {
    site_id: [site_id],
    lead_id: [lead_id],
  };
  if (options.userId) {
    searchAttributes.user_id = [options.userId];
  }
  upsertSearchAttributes(searchAttributes);

  const workflowId = `lead-company-research-${lead_id}-${site_id}`;
  const startTime = Date.now();
  
  console.log(`🌐 Starting lead company research workflow for lead ${lead_id} on site ${site_id}`);
  console.log(`📋 Website to analyze: ${website}`);
  console.log(`📋 Options:`, JSON.stringify(options, null, 2));

  // Log workflow execution start
  await logWorkflowExecutionActivity({
    workflowId,
    workflowType: 'leadCompanyResearchWorkflow',
    status: 'STARTED',
    input: options,
  });

  // Update cron status to indicate the workflow is running
  await saveCronStatusActivity({
    siteId: site_id,
    workflowId,
    scheduleId: `lead-company-research-${lead_id}-${site_id}`,
    activityName: 'leadCompanyResearchWorkflow',
    status: 'RUNNING',
    lastRun: new Date().toISOString()
  });

  const errors: string[] = [];
  let siteName = '';
  let siteUrl = '';
  let companyInfo: any = null;

  try {
    console.log(`🏢 Step 1: Getting site information for ${site_id}...`);
    
    // Get site information
    const siteResult = await getSiteActivity(site_id);
    
    if (!siteResult.success) {
      const errorMsg = `Failed to get site information: ${siteResult.error}`;
      console.error(`❌ ${errorMsg}`);
      errors.push(errorMsg);
      throw new Error(errorMsg);
    }
    
    const site = siteResult.site!;
    siteName = site.name;
    siteUrl = site.url;
    
    console.log(`✅ Retrieved site information: ${siteName} (${siteUrl})`);

    console.log(`👤 Step 2: Getting lead information for ${lead_id}...`);
    
    // Get lead information
    const leadResult = await getLeadActivity(lead_id);
    
    if (!leadResult.success) {
      const errorMsg = `Failed to get lead information: ${leadResult.error}`;
      console.error(`❌ ${errorMsg}`);
      errors.push(errorMsg);
      throw new Error(errorMsg);
    }
    
    const leadInfo = leadResult.lead!;
    
    console.log(`✅ Retrieved lead information: ${leadInfo.name || leadInfo.email}`);

    console.log(`🔍 Step 3: Generating research query for website analysis...`);
    
    // Generate research query focused on website analysis
    // IMPORTANT: Be very explicit about which website to analyze to avoid AI confusion
    const researchQuery = `WEBSITE TO ANALYZE: ${website}

TASK: Extract the following information from the company website at ${website}:

1) COMPANY SUMMARY: A concise description of what this company does (their main business)
2) SERVICES/PRODUCTS: List the main services or products they offer
3) NOTABLE CLIENTS: Any clients, customers, or case studies mentioned on their website

INSTRUCTIONS:
- Focus ONLY on factual information found on ${website}
- Do NOT confuse this with any other company
- Extract information directly from the website content
- Be concise and accurate`;
    
    console.log(`📝 Research query generated for website: ${website}`);
    
    console.log(`🔬 Step 4: Executing deep research workflow for website analysis...`);
    
    // Define deliverables structure for company information - ONLY what we need
    const deliverables = {
      company: {
        summary: null,
        services: [],
        clients: []
      }
    };
    
    // Prepare options for the deep research workflow
    // NOTE: Do NOT send siteName/siteUrl to avoid confusion with the company being researched
    const deepResearchOptions: DeepResearchOptions = {
      site_id: site_id,
      research_topic: researchQuery,
      userId: options.userId || site.user_id,
      deliverables: deliverables,
      parentWorkflowType: 'leadCompanyResearchWorkflow',
      additionalData: {
        leadId: lead_id,
        websiteToAnalyze: website, // Clear naming: this is the website we want to analyze
        researchContext: 'company_website_analysis',
        targetCompanyWebsite: website, // Explicit: this is the target company's website
        // NOTE: siteName and siteUrl are intentionally excluded to avoid AI confusion
        // The site_id is our client's site, not the company being researched
      }
    };
    
    // Execute deep research workflow as child process
    try {
      const deepResearchHandle = await startChild(deepResearchWorkflow, {
        args: [deepResearchOptions],
        workflowId: `deep-research-company-${lead_id}-${Date.now()}`,
        parentClosePolicy: ParentClosePolicy.PARENT_CLOSE_POLICY_ABANDON,
      });
      
      const deepResearchResult = await deepResearchHandle.result();
      
      if (deepResearchResult.success) {
        console.log(`✅ Deep research completed successfully`);
        
        // Extract company information from results
        if (deepResearchResult.data && deepResearchResult.data.deliverables) {
          companyInfo = deepResearchResult.data.deliverables.company || {};
          console.log(`📊 Extracted company info:`, JSON.stringify(companyInfo, null, 2));
        } else if (deepResearchResult.data) {
          // Fallback: try to extract from analysis or insights
          companyInfo = {
            summary: deepResearchResult.data.analysis || '',
            services: [],
            clients: []
          };
          console.log(`📊 Extracted company info from analysis`);
        }
        
        if (!companyInfo || Object.keys(companyInfo).length === 0) {
          console.log(`⚠️ No company information extracted from deep research`);
          errors.push('No company information could be extracted from website');
        }
      } else {
        const errorMsg = `Deep research failed: ${deepResearchResult.error || 'Unknown error'}`;
        console.error(`❌ ${errorMsg}`);
        errors.push(errorMsg);
      }
    } catch (deepResearchError) {
      const errorMessage = deepResearchError instanceof Error ? deepResearchError.message : String(deepResearchError);
      console.error(`⚠️ Deep research workflow failed: ${errorMessage}`);
      errors.push(`Deep research error: ${errorMessage}`);
    }

    // Step 5: Update lead notes with company information
    if (companyInfo && Object.keys(companyInfo).length > 0) {
      console.log(`📝 Step 5: Updating lead notes with company information...`);
      
      try {
        const formattedNotes = formatCompanyInfoForNotes(website, companyInfo);
        
        // Get existing notes to append to them
        const existingNotes = leadInfo.notes || '';
        const updatedNotes = existingNotes 
          ? `${existingNotes}\n\n${formattedNotes}`
          : formattedNotes;
        
        const leadUpdateResult = await updateLeadActivity({
          lead_id: lead_id,
          updateData: {
            notes: updatedNotes,
            metadata: {
              ...leadInfo.metadata,
              company_research_completed: true,
              company_research_date: new Date().toISOString(),
              company_research_website: website
            }
          },
          safeUpdate: true
        });
        
        if (leadUpdateResult.success) {
          console.log(`✅ Lead notes updated successfully with company information`);
        } else {
          const errorMsg = `Failed to update lead notes: ${leadUpdateResult.error}`;
          console.error(`❌ ${errorMsg}`);
          errors.push(errorMsg);
        }
      } catch (updateError) {
        const updateErrorMessage = updateError instanceof Error ? updateError.message : String(updateError);
        console.error(`❌ Exception updating lead notes: ${updateErrorMessage}`);
        errors.push(`Lead notes update exception: ${updateErrorMessage}`);
      }
      
      // Step 6: Update company description if company exists
      if (leadInfo.company_id && companyInfo.summary) {
        console.log(`🏢 Step 6: Updating company description...`);
        
        try {
          const companyUpdateResult = await upsertCompanyActivity({
            id: leadInfo.company_id,
            description: companyInfo.summary
          });
          
          if (companyUpdateResult.success) {
            console.log(`✅ Company description updated successfully`);
          } else {
            const errorMsg = `Failed to update company description: ${companyUpdateResult.error}`;
            console.error(`❌ ${errorMsg}`);
            errors.push(errorMsg);
          }
        } catch (companyUpdateError) {
          const companyUpdateErrorMessage = companyUpdateError instanceof Error ? companyUpdateError.message : String(companyUpdateError);
          console.error(`❌ Exception updating company: ${companyUpdateErrorMessage}`);
          errors.push(`Company update exception: ${companyUpdateErrorMessage}`);
        }
      } else if (leadInfo.company_id) {
        console.log(`ℹ️ Company exists but no summary to update`);
      } else {
        console.log(`ℹ️ No company_id found, skipping company description update`);
      }
    } else {
      console.log(`⚠️ No company information to save`);
    }

    const executionTime = `${((Date.now() - startTime) / 1000).toFixed(2)}s`;
    
    const result: LeadCompanyResearchResult = {
      success: true,
      leadId: lead_id,
      siteId: site_id,
      website: website,
      siteName,
      siteUrl,
      companyInfo: companyInfo ? {
        summary: companyInfo.summary || '',
        services: companyInfo.services || [],
        clients: companyInfo.clients || []
      } : undefined,
      errors,
      executionTime,
      completedAt: new Date().toISOString()
    };

    console.log(`🎉 Lead company research workflow completed!`);
    console.log(`📊 Summary: Company research for lead ${lead_id} completed in ${executionTime}`);
    console.log(`   - Website: ${website}`);
    console.log(`   - Company info extracted: ${companyInfo ? 'Yes' : 'No'}`);

    // Update cron status to indicate successful completion
    await saveCronStatusActivity({
      siteId: site_id,
      workflowId,
      scheduleId: `lead-company-research-${lead_id}-${site_id}`,
      activityName: 'leadCompanyResearchWorkflow',
      status: 'COMPLETED',
      lastRun: new Date().toISOString()
    });

    // Log successful completion
    await logWorkflowExecutionActivity({
      workflowId,
      workflowType: 'leadCompanyResearchWorkflow',
      status: 'COMPLETED',
      input: options,
      output: result,
    });

    return result;

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Lead company research workflow failed: ${errorMessage}`);
    
    // Update cron status to indicate failure
    await saveCronStatusActivity({
      siteId: site_id,
      workflowId,
      scheduleId: `lead-company-research-${lead_id}-${site_id}`,
      activityName: 'leadCompanyResearchWorkflow',
      status: 'FAILED',
      lastRun: new Date().toISOString(),
      errorMessage: errorMessage,
      retryCount: 1
    });

    // Log workflow execution failure
    await logWorkflowExecutionActivity({
      workflowId,
      workflowType: 'leadCompanyResearchWorkflow',
      status: 'FAILED',
      input: options,
      error: errorMessage,
    });

    // Throw error to properly fail the workflow
    throw new Error(`Lead company research workflow failed: ${errorMessage}`);
  }
}

