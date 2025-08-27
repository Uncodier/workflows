"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildSingleSegmentICPWorkflow = buildSingleSegmentICPWorkflow;
exports.buildSegmentsICPWorkflow = buildSegmentsICPWorkflow;
const workflow_1 = require("@temporalio/workflow");
// Define the activity interface and options
const { logWorkflowExecutionActivity, saveCronStatusActivity, getSiteActivity, getSegmentsActivity, buildICPSegmentsActivity, } = (0, workflow_1.proxyActivities)({
    startToCloseTimeout: '5 minutes', // Each activity has 5 minutes maximum execution time
    retry: {
        maximumAttempts: 3,
    },
});
/**
 * Sub-workflow to build ICP for a single segment
 *
 * This workflow processes one segment at a time to create ICP analysis
 *
 * @param options - Configuration options for single segment ICP building
 */
async function buildSingleSegmentICPWorkflow(options) {
    const { siteId, segmentId, segmentName, userId } = options;
    const startTime = Date.now();
    const workflowId = `build-single-segment-icp-${siteId}-${segmentId}`;
    console.log(`🎯 Starting single segment ICP workflow for segment ${segmentId} in site ${siteId}`);
    try {
        // Log workflow execution start
        await logWorkflowExecutionActivity({
            workflowId,
            workflowType: 'buildSingleSegmentICPWorkflow',
            status: 'STARTED',
            input: options,
        });
        console.log(`📊 Building ICP for segment ${segmentId}...`);
        // Build ICP for this single segment
        const icpRequest = {
            siteId: siteId,
            userId: userId,
            segmentIds: [segmentId]
        };
        const icpResult = await buildICPSegmentsActivity(icpRequest);
        const executionTime = `${((Date.now() - startTime) / 1000).toFixed(2)}s`;
        const result = {
            success: true,
            siteId,
            segmentId,
            segmentName,
            icpSegment: icpResult.segments?.[0],
            analysis: icpResult.analysis,
            executionTime,
            completedAt: new Date().toISOString()
        };
        console.log(`✅ ICP built successfully for segment ${segmentId} in ${executionTime}`);
        // Log successful completion
        await logWorkflowExecutionActivity({
            workflowId,
            workflowType: 'buildSingleSegmentICPWorkflow',
            status: 'COMPLETED',
            input: options,
            output: result,
        });
        return result;
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`❌ Single segment ICP workflow failed for segment ${segmentId}: ${errorMessage}`);
        const executionTime = `${((Date.now() - startTime) / 1000).toFixed(2)}s`;
        // Log workflow execution failure
        await logWorkflowExecutionActivity({
            workflowId,
            workflowType: 'buildSingleSegmentICPWorkflow',
            status: 'FAILED',
            input: options,
            error: errorMessage,
        });
        const result = {
            success: false,
            siteId,
            segmentId,
            segmentName,
            error: errorMessage,
            executionTime,
            completedAt: new Date().toISOString()
        };
        return result;
    }
}
/**
 * Workflow to build ICP segments for a site
 *
 * This workflow:
 * 1. Gets site information by siteId to obtain the URL
 * 2. Gets existing segments for the site
 * 3. Builds ICP segments one by one using child workflows for better robustness
 *
 * @param options - Configuration options for ICP segment building
 */
async function buildSegmentsICPWorkflow(options) {
    // Support both siteId (legacy) and site_id (new)
    const siteId = options.site_id || options.siteId;
    if (!siteId) {
        throw new Error('No site ID provided');
    }
    const workflowId = `build-segments-icp-${siteId}`;
    const startTime = Date.now();
    console.log(`🎯 Starting build ICP segments workflow for site ${siteId}`);
    console.log(`📋 Options:`, JSON.stringify(options, null, 2));
    // Log workflow execution start
    await logWorkflowExecutionActivity({
        workflowId,
        workflowType: 'buildSegmentsICPWorkflow',
        status: 'STARTED',
        input: options,
    });
    // Update cron status to indicate the workflow is running
    await saveCronStatusActivity({
        siteId: siteId,
        workflowId,
        scheduleId: `build-segments-icp-${siteId}`,
        activityName: 'buildSegmentsICPWorkflow',
        status: 'RUNNING',
        lastRun: new Date().toISOString()
    });
    const errors = [];
    const icpSegments = [];
    let analysis = null;
    let icpSegmentsBuilt = 0;
    let siteName = '';
    let siteUrl = '';
    let segmentIds = [];
    const childWorkflowResults = [];
    try {
        console.log(`🏢 Step 1: Getting site information for ${siteId}...`);
        // Get site information to obtain the URL
        const siteResult = await getSiteActivity(siteId);
        if (!siteResult.success) {
            const errorMsg = `Failed to get site information: ${siteResult.error}`;
            console.error(`❌ ${errorMsg}`);
            errors.push(errorMsg);
            throw new Error(errorMsg);
        }
        const site = siteResult.site;
        siteName = site.name;
        siteUrl = site.url;
        console.log(`✅ Retrieved site information: ${siteName} (${siteUrl})`);
        console.log(`📊 Step 2: Getting existing segments for ${siteName}...`);
        // Get existing segments for the site
        if (options.segmentIds && options.segmentIds.length > 0) {
            // Use provided segment IDs
            segmentIds = options.segmentIds;
            console.log(`📋 Using provided segment IDs: ${segmentIds.join(', ')}`);
        }
        else {
            // Fetch segments from the site
            const segmentsResult = await getSegmentsActivity(siteId);
            if (!segmentsResult.success) {
                const errorMsg = `Failed to get segments for site: ${segmentsResult.error}`;
                console.error(`❌ ${errorMsg}`);
                errors.push(errorMsg);
                throw new Error(errorMsg);
            }
            const segments = segmentsResult.segments || [];
            segmentIds = segments.map(segment => segment.id);
            console.log(`✅ Retrieved ${segments.length} existing segments`);
            if (segments.length > 0) {
                console.log(`📋 Segment IDs: ${segmentIds.join(', ')}`);
                segments.forEach((segment, index) => {
                    console.log(`   ${index + 1}. ${segment.name} (${segment.id})`);
                });
            }
        }
        if (segmentIds.length === 0) {
            const errorMsg = `No segments found for site ${siteId}. ICP segments require existing segments.`;
            console.error(`❌ ${errorMsg}`);
            errors.push(errorMsg);
            throw new Error(errorMsg);
        }
        console.log(`🎯 Step 3: Building ICP segments for ${siteName} (${segmentIds.length} segments)...`);
        console.log(`📝 Processing segments one by one for better reliability...`);
        // Process each segment one by one using child workflows
        for (let i = 0; i < segmentIds.length; i++) {
            const segmentId = segmentIds[i];
            const segmentIndex = i + 1;
            console.log(`🔄 Processing segment ${segmentIndex}/${segmentIds.length}: ${segmentId}`);
            try {
                // Start child workflow for this segment
                const childWorkflowHandle = await (0, workflow_1.startChild)(buildSingleSegmentICPWorkflow, {
                    workflowId: `build-single-segment-icp-${siteId}-${segmentId}-${Date.now()}`,
                    args: [{
                            siteId: siteId,
                            userId: options.userId || site.user_id,
                            segmentId: segmentId,
                            aiProvider: options.aiProvider,
                            aiModel: options.aiModel
                        }],
                });
                console.log(`⏳ Waiting for segment ${segmentId} ICP completion...`);
                const segmentResult = await childWorkflowHandle.result();
                childWorkflowResults.push(segmentResult);
                if (segmentResult.success && segmentResult.icpSegment) {
                    icpSegments.push(segmentResult.icpSegment);
                    icpSegmentsBuilt++;
                    console.log(`✅ Segment ${segmentIndex}/${segmentIds.length} completed successfully: ${segmentId}`);
                }
                else {
                    const errorMsg = `Failed to build ICP for segment ${segmentId}: ${segmentResult.error}`;
                    console.error(`❌ ${errorMsg}`);
                    errors.push(errorMsg);
                }
                // Small delay between segments to avoid overwhelming the system
                if (i < segmentIds.length - 1) {
                    console.log(`⏳ Waiting 5 seconds before processing next segment...`);
                    await new Promise(resolve => setTimeout(resolve, 5000));
                }
            }
            catch (error) {
                const errorMsg = `Exception processing segment ${segmentId}: ${error instanceof Error ? error.message : String(error)}`;
                console.error(`❌ ${errorMsg}`);
                errors.push(errorMsg);
            }
        }
        // Combine analysis from all segments
        if (childWorkflowResults.length > 0) {
            analysis = {
                processedSegments: childWorkflowResults.length,
                successfulSegments: icpSegmentsBuilt,
                failedSegments: childWorkflowResults.length - icpSegmentsBuilt,
                segmentResults: childWorkflowResults,
                combinedAnalysis: childWorkflowResults
                    .filter(result => result.success && result.analysis)
                    .map(result => result.analysis)
            };
        }
        console.log(`✅ Successfully processed ${icpSegmentsBuilt}/${segmentIds.length} ICP segments for ${siteName}`);
        console.log(`📊 Results: ${icpSegmentsBuilt} ICP segments created, ${errors.length} errors`);
        const executionTime = `${((Date.now() - startTime) / 1000).toFixed(2)}s`;
        const result = {
            success: icpSegmentsBuilt > 0, // Success if at least one segment was processed
            siteId: siteId,
            siteName,
            siteUrl,
            icpSegmentsBuilt,
            segmentIds,
            segments: icpSegments,
            analysis,
            errors,
            executionTime,
            completedAt: new Date().toISOString()
        };
        console.log(`🎉 Build ICP segments workflow completed!`);
        console.log(`📊 Summary: ${icpSegmentsBuilt}/${segmentIds.length} ICP segments built for ${siteName} in ${executionTime}`);
        // Update cron status to indicate completion (successful or partial)
        await saveCronStatusActivity({
            siteId: siteId,
            workflowId,
            scheduleId: `build-segments-icp-${siteId}`,
            activityName: 'buildSegmentsICPWorkflow',
            status: result.success ? 'COMPLETED' : 'PARTIAL_SUCCESS',
            lastRun: new Date().toISOString()
        });
        // Log completion
        await logWorkflowExecutionActivity({
            workflowId,
            workflowType: 'buildSegmentsICPWorkflow',
            status: result.success ? 'COMPLETED' : 'PARTIAL_SUCCESS',
            input: options,
            output: result,
        });
        return result;
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`❌ Build ICP segments workflow failed: ${errorMessage}`);
        // Update cron status to indicate failure
        await saveCronStatusActivity({
            siteId: siteId,
            workflowId,
            scheduleId: `build-segments-icp-${siteId}`,
            activityName: 'buildSegmentsICPWorkflow',
            status: 'FAILED',
            lastRun: new Date().toISOString(),
            errorMessage: errorMessage,
            retryCount: 1
        });
        // Log workflow execution failure
        await logWorkflowExecutionActivity({
            workflowId,
            workflowType: 'buildSegmentsICPWorkflow',
            status: 'FAILED',
            input: options,
            error: errorMessage,
        });
        // Throw error to properly fail the workflow
        throw new Error(`Build segments ICP workflow failed: ${errorMessage}`);
    }
}
