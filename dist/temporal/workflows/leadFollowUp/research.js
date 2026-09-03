"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.performResearch = performResearch;
const workflow_1 = require("@temporalio/workflow");
const leadResearchWorkflow_1 = require("../leadResearchWorkflow");
const leadCompanyResearchWorkflow_1 = require("../leadCompanyResearchWorkflow");
const utils_1 = require("./utils");
async function performResearch({ lead_id, site_id, leadInfo, options, site, workflowId, errors }) {
    // Check if lead needs research before follow-up (now that we know contact is valid)
    if (options.researchEnabled && (0, utils_1.shouldExecuteLeadResearch)(leadInfo)) {
        console.log(`🔍 Step 2.2: Executing lead research after contact validation...`);
        try {
            const leadResearchOptions = {
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
            const leadResearchHandle = await (0, workflow_1.startChild)(leadResearchWorkflow_1.leadResearchWorkflow, {
                args: [leadResearchOptions],
                workflowId: `lead-research-followup-${lead_id}-${site_id}-${(0, workflow_1.workflowInfo)().runId}`,
            });
            const leadResearchResult = await leadResearchHandle.result();
            if (leadResearchResult.success) {
                console.log(`✅ Lead research completed successfully before follow-up`);
                console.log(`📊 Research results:`);
                console.log(`   - Lead information enriched: Yes`);
                console.log(`   - Deep research executed: ${leadResearchResult.deepResearchResult ? 'Yes' : 'No'}`);
                console.log(`   - Lead segmentation executed: ${leadResearchResult.leadSegmentationResult ? 'Yes' : 'No'}`);
                console.log(`   - Execution time: ${leadResearchResult.executionTime}`);
            }
            else {
                console.error(`⚠️ Lead research failed, but continuing with follow-up: ${leadResearchResult.errors.join(', ')}`);
                errors.push(`Lead research failed: ${leadResearchResult.errors.join(', ')}`);
            }
        }
        catch (researchError) {
            const errorMessage = researchError instanceof Error ? researchError.message : String(researchError);
            console.error(`⚠️ Exception during lead research, but continuing with follow-up: ${errorMessage}`);
            errors.push(`Lead research exception: ${errorMessage}`);
        }
    }
    else if ((0, utils_1.shouldExecuteLeadResearch)(leadInfo)) {
        console.log(`⏭️ Skipping lead research - research is disabled (researchEnabled=${options.researchEnabled})`);
    }
    else {
        console.log(`⏭️ Skipping lead research - lead does not meet criteria`);
    }
    // Check if lead needs company website research (lighter alternative)
    if (options.researchEnabled && !(0, utils_1.shouldExecuteLeadResearch)(leadInfo) && (0, utils_1.shouldExecuteCompanyResearch)(leadInfo)) {
        console.log(`🌐 Step 2.3: Executing company website research...`);
        const website = (0, utils_1.extractWebsite)(leadInfo);
        try {
            const companyResearchOptions = {
                lead_id: lead_id,
                site_id: site_id,
                website: website,
                userId: options.userId || site.user_id,
                additionalData: {
                    ...options.additionalData,
                    executedBeforeFollowUp: true,
                    followUpWorkflowId: workflowId
                }
            };
            console.log(`🚀 Starting company website research workflow as child process...`);
            const companyResearchHandle = await (0, workflow_1.startChild)(leadCompanyResearchWorkflow_1.leadCompanyResearchWorkflow, {
                args: [companyResearchOptions],
                workflowId: `lead-company-research-${lead_id}-${(0, workflow_1.workflowInfo)().runId}`,
                parentClosePolicy: workflow_1.ParentClosePolicy.PARENT_CLOSE_POLICY_ABANDON
            });
            const companyResearchResult = await companyResearchHandle.result();
            if (companyResearchResult.success) {
                console.log(`✅ Company research completed successfully`);
                console.log(`📊 Research results:`);
                console.log(`   - Website analyzed: ${companyResearchResult.website}`);
                console.log(`   - Company info extracted: ${companyResearchResult.companyInfo ? 'Yes' : 'No'}`);
                console.log(`   - Execution time: ${companyResearchResult.executionTime}`);
            }
            else {
                console.error(`⚠️ Company research failed, but continuing with follow-up: ${companyResearchResult.errors.join(', ')}`);
                errors.push(`Company research failed: ${companyResearchResult.errors.join(', ')}`);
            }
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(`⚠️ Exception during company research, but continuing with follow-up: ${errorMessage}`);
            errors.push(`Company research exception: ${errorMessage}`);
        }
    }
    else if (!(0, utils_1.shouldExecuteLeadResearch)(leadInfo) && (0, utils_1.shouldExecuteCompanyResearch)(leadInfo)) {
        console.log(`⏭️ Skipping company research - research is disabled (researchEnabled=${options.researchEnabled})`);
    }
    else {
        console.log(`⏭️ Skipping company research - lead does not meet criteria (either has notes or no website)`);
    }
}
