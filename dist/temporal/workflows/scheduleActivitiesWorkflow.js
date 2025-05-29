"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scheduleActivitiesWorkflow = scheduleActivitiesWorkflow;
const workflow_1 = require("@temporalio/workflow");
const activityPrioritizationEngineWorkflow_1 = require("./activityPrioritizationEngineWorkflow");
const sendReportWorkflow_1 = require("./sendReportWorkflow");
// Configure activity options
const { getProjects, schedulePrioritizationEngine } = (0, workflow_1.proxyActivities)({
    startToCloseTimeout: '1 minute',
});
/**
 * Central Schedule Activities Workflow
 * This workflow runs daily and orchestrates other workflows
 */
async function scheduleActivitiesWorkflow() {
    console.log('🚀 Starting central schedule activities workflow...');
    const startTime = new Date();
    try {
        // Step 1: Get projects
        console.log('📂 Step 1: Getting projects...');
        const projectsResult = await getProjects();
        console.log(`✅ Retrieved ${projectsResult.count} projects`);
        // Step 2: Schedule prioritization engine workflow
        console.log('🎯 Step 2: Scheduling prioritization engine...');
        const scheduleResult = await schedulePrioritizationEngine();
        console.log(`✅ Prioritization engine scheduled: ${scheduleResult.workflowId}`);
        // Step 3: Start the prioritization engine workflow as a child workflow
        console.log('🔄 Step 3: Starting prioritization engine workflow...');
        const prioritizationHandle = await (0, workflow_1.startChild)(activityPrioritizationEngineWorkflow_1.activityPrioritizationEngineWorkflow, {
            workflowId: `prioritization-${Date.now()}`,
            args: [],
        });
        console.log(`✅ Prioritization engine workflow started: ${prioritizationHandle.workflowId}`);
        // Step 4: Start the send report workflow as a child workflow
        console.log('📊 Step 4: Starting send report workflow...');
        const reportHandle = await (0, workflow_1.startChild)(sendReportWorkflow_1.sendReportWorkflow, {
            workflowId: `report-${Date.now()}`,
            args: [],
        });
        console.log(`✅ Send report workflow started: ${reportHandle.workflowId}`);
        // Wait for both child workflows to complete
        console.log('⏳ Waiting for child workflows to complete...');
        const [prioritizationResult, reportResult] = await Promise.all([
            prioritizationHandle.result(),
            reportHandle.result()
        ]);
        const endTime = new Date();
        const executionTime = `${endTime.getTime() - startTime.getTime()}ms`;
        console.log('🎉 Central schedule activities workflow completed successfully');
        return {
            projectsRetrieved: projectsResult.count,
            prioritizationEngineScheduled: true,
            sendReportScheduled: true,
            prioritizationEngineResult: prioritizationResult,
            sendReportResult: reportResult,
            executionTime
        };
    }
    catch (error) {
        console.error('❌ Central schedule activities workflow failed:', error);
        throw error;
    }
}
