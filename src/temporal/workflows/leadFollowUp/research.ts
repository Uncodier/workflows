import { startChild, ParentClosePolicy } from '@temporalio/workflow';
import { leadResearchWorkflow, type LeadResearchOptions, type LeadResearchResult } from '../leadResearchWorkflow';
import { leadCompanyResearchWorkflow, type LeadCompanyResearchOptions, type LeadCompanyResearchResult } from '../leadCompanyResearchWorkflow';
import { shouldExecuteLeadResearch, shouldExecuteCompanyResearch, extractWebsite } from './utils';
import type { LeadFollowUpOptions } from './types';

export async function performResearch({
  lead_id,
  site_id,
  leadInfo,
  options,
  site,
  workflowId,
  errors
}: {
  lead_id: string;
  site_id: string;
  leadInfo: any;
  options: LeadFollowUpOptions;
  site: any;
  workflowId: string;
  errors: string[];
}): Promise<void> {
  // Check if lead needs research before follow-up (now that we know contact is valid)
  if (shouldExecuteLeadResearch(leadInfo)) {
    console.log(`🔍 Step 2.2: Executing lead research after contact validation...`);
    
    try {
      const leadResearchOptions: LeadResearchOptions = {
        lead_id: lead_id,
        site_id: site_id,
        userId: options.userId || site.user_id,
        additionalData: {
          ...options.additionalData,
          executedBeforeFollowUp: true,
          followUpWorkflowId: workflowId,
          researchReason: 'missing_notes_and_metadata',
          originalLeadInfo: leadInfo
        }
      };
      
      console.log(`🚀 Starting lead research workflow as child process...`);
      
      const leadResearchHandle = await startChild(leadResearchWorkflow, {
        args: [leadResearchOptions],
        workflowId: `lead-research-followup-${lead_id}-${site_id}-${Date.now()}`,
      });
      
      const leadResearchResult: LeadResearchResult = await leadResearchHandle.result();
      
      if (leadResearchResult.success) {
        console.log(`✅ Lead research completed successfully before follow-up`);
        console.log(`📊 Research results:`);
        console.log(`   - Lead information enriched: Yes`);
        console.log(`   - Deep research executed: ${leadResearchResult.deepResearchResult ? 'Yes' : 'No'}`);
        console.log(`   - Lead segmentation executed: ${leadResearchResult.leadSegmentationResult ? 'Yes' : 'No'}`);
        console.log(`   - Execution time: ${leadResearchResult.executionTime}`);
      } else {
        console.error(`⚠️ Lead research failed, but continuing with follow-up: ${leadResearchResult.errors.join(', ')}`);
        errors.push(`Lead research failed: ${leadResearchResult.errors.join(', ')}`);
      }
      
    } catch (researchError) {
      const errorMessage = researchError instanceof Error ? researchError.message : String(researchError);
      console.error(`⚠️ Exception during lead research, but continuing with follow-up: ${errorMessage}`);
      errors.push(`Lead research exception: ${errorMessage}`);
    }
  } else {
    console.log(`⏭️ Skipping lead research - lead does not meet criteria`);
  }
  
  // Check if lead needs company website research (lighter alternative)
  if (!shouldExecuteLeadResearch(leadInfo) && shouldExecuteCompanyResearch(leadInfo)) {
    console.log(`🌐 Step 2.3: Executing company website research...`);
    
    const website = extractWebsite(leadInfo);
    
    try {
      const companyResearchOptions: LeadCompanyResearchOptions = {
        lead_id: lead_id,
        site_id: site_id,
        website: website!,
        userId: options.userId || site.user_id,
        additionalData: {
          ...options.additionalData,
          executedBeforeFollowUp: true,
          followUpWorkflowId: workflowId
        }
      };
      
      console.log(`🚀 Starting company website research workflow as child process...`);
      
      const companyResearchHandle = await startChild(leadCompanyResearchWorkflow, {
        args: [companyResearchOptions],
        workflowId: `lead-company-research-${lead_id}-${Date.now()}`,
        parentClosePolicy: ParentClosePolicy.PARENT_CLOSE_POLICY_ABANDON
      });
      
      const companyResearchResult: LeadCompanyResearchResult = await companyResearchHandle.result();
      
      if (companyResearchResult.success) {
        console.log(`✅ Company research completed successfully`);
        console.log(`📊 Research results:`);
        console.log(`   - Website analyzed: ${companyResearchResult.website}`);
        console.log(`   - Company info extracted: ${companyResearchResult.companyInfo ? 'Yes' : 'No'}`);
        console.log(`   - Execution time: ${companyResearchResult.executionTime}`);
      } else {
        console.error(`⚠️ Company research failed, but continuing with follow-up: ${companyResearchResult.errors.join(', ')}`);
        errors.push(`Company research failed: ${companyResearchResult.errors.join(', ')}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`⚠️ Exception during company research, but continuing with follow-up: ${errorMessage}`);
      errors.push(`Company research exception: ${errorMessage}`);
    }
  } else {
    console.log(`⏭️ Skipping company research - lead does not meet criteria (either has notes or no website)`);
  }
}
