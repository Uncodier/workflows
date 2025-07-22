#!/usr/bin/env node
"use strict";
/**
 * Script to monitor active workflows and determine when versioning patches can be cleaned up
 *
 * This script helps track when all old workflows (pre-patch) have completed,
 * allowing us to safely remove versioning code.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.monitorWorkflowVersions = monitorWorkflowVersions;
const config_1 = require("../config/config");
async function monitorWorkflowVersions() {
    try {
        console.log('🔍 Monitoring Temporal Workflows for Version Management');
        console.log('================================================\n');
        // Use require to avoid TypeScript issues with @temporalio/client
        const { Connection, Client } = require('@temporalio/client');
        // Create Temporal client
        const connection = await Connection.connect({
            address: config_1.temporalConfig.serverUrl,
            tls: config_1.temporalConfig.tls ? {} : undefined,
        });
        const client = new Client({
            connection,
            namespace: config_1.temporalConfig.namespace,
        });
        // Query for leadFollowUpWorkflow instances
        const leadFollowUpQuery = `WorkflowType = "leadFollowUpWorkflow"`;
        console.log('📊 Querying leadFollowUpWorkflow instances...\n');
        const workflows = client.workflow.list({
            query: leadFollowUpQuery,
        });
        const activeWorkflows = [];
        const completedWorkflows = [];
        const failedWorkflows = [];
        for await (const workflow of workflows) {
            const summary = {
                workflowId: workflow.workflowId,
                workflowType: workflow.workflowType,
                status: workflow.status.name,
                startTime: workflow.startTime,
                runTime: workflow.runTime ? `${Math.floor((Date.now() - workflow.startTime.getTime()) / 1000)}s` : 'N/A',
                taskQueue: workflow.taskQueue,
            };
            switch (workflow.status.name) {
                case 'RUNNING':
                case 'CONTINUED_AS_NEW':
                    activeWorkflows.push(summary);
                    break;
                case 'COMPLETED':
                    completedWorkflows.push(summary);
                    break;
                case 'FAILED':
                case 'TERMINATED':
                case 'TIMED_OUT':
                case 'CANCELED':
                    failedWorkflows.push(summary);
                    break;
            }
        }
        // Display results
        console.log('📈 WORKFLOW STATUS SUMMARY');
        console.log('==========================');
        console.log(`🟢 Active workflows: ${activeWorkflows.length}`);
        console.log(`✅ Completed workflows: ${completedWorkflows.length}`);
        console.log(`❌ Failed/Terminated workflows: ${failedWorkflows.length}`);
        console.log(`📊 Total workflows found: ${activeWorkflows.length + completedWorkflows.length + failedWorkflows.length}\n`);
        // Show active workflows details
        if (activeWorkflows.length > 0) {
            console.log('🟡 ACTIVE WORKFLOWS (Still Running)');
            console.log('===================================');
            activeWorkflows.forEach((wf, index) => {
                console.log(`${index + 1}. ${wf.workflowId}`);
                console.log(`   📅 Started: ${wf.startTime.toISOString()}`);
                console.log(`   ⏱️  Runtime: ${wf.runTime}`);
                console.log(`   📋 Queue: ${wf.taskQueue}`);
                console.log('');
            });
        }
        // Show recent failed workflows
        if (failedWorkflows.length > 0) {
            console.log('❌ RECENT FAILED WORKFLOWS');
            console.log('==========================');
            failedWorkflows.slice(0, 5).forEach((wf, index) => {
                console.log(`${index + 1}. ${wf.workflowId} - ${wf.status}`);
                console.log(`   📅 Started: ${wf.startTime.toISOString()}`);
                console.log('');
            });
            if (failedWorkflows.length > 5) {
                console.log(`... and ${failedWorkflows.length - 5} more failed workflows\n`);
            }
        }
        // Versioning recommendations
        console.log('🔧 VERSIONING PATCH RECOMMENDATIONS');
        console.log('===================================');
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - 1); // Workflows older than 1 day
        const oldActiveWorkflows = activeWorkflows.filter(wf => wf.startTime < cutoffDate);
        if (oldActiveWorkflows.length === 0) {
            console.log('✅ SAFE TO REMOVE PATCH: No old active workflows found');
            console.log('   All active workflows were started after the patch was deployed');
            console.log('   You can safely remove the versioning code in leadFollowUpWorkflow.ts');
            console.log('   Remove the following:');
            console.log('   - import { patched, deprecatePatch }');
            console.log('   - const shouldGetLeadInfo = patched(\'add-lead-info-check-v1\');');
            console.log('   - deprecatePatch(\'add-lead-info-check-v1\');');
            console.log('   - The if (shouldGetLeadInfo) conditional logic');
            console.log('   - Always execute the lead info check path\n');
        }
        else {
            console.log('⚠️  KEEP PATCH: Old workflows still active');
            console.log(`   Found ${oldActiveWorkflows.length} active workflows that started before patch deployment`);
            console.log('   Wait for these workflows to complete before removing versioning code');
            console.log('   Old active workflows:');
            oldActiveWorkflows.forEach((wf, index) => {
                console.log(`   ${index + 1}. ${wf.workflowId} (started ${wf.startTime.toISOString()})`);
            });
            console.log('');
        }
        // Check for non-deterministic errors
        const recentFailures = failedWorkflows.filter(wf => {
            const hourAgo = new Date();
            hourAgo.setHours(hourAgo.getHours() - 1);
            return wf.startTime > hourAgo;
        });
        if (recentFailures.length > 0) {
            console.log('🚨 RECENT FAILURES DETECTED');
            console.log('===========================');
            console.log(`Found ${recentFailures.length} workflows that failed in the last hour`);
            console.log('This might indicate non-deterministic errors or other issues');
            console.log('Consider investigating these failures\n');
        }
        await connection.close();
    }
    catch (error) {
        console.error('❌ Error monitoring workflows:', error);
        process.exit(1);
    }
}
// Run if called directly
if (require.main === module) {
    monitorWorkflowVersions()
        .then(() => {
        console.log('✅ Monitoring completed successfully');
        process.exit(0);
    })
        .catch((error) => {
        console.error('❌ Monitoring failed:', error);
        process.exit(1);
    });
}
