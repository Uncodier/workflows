"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildSegmentsWorkflow = buildSegmentsWorkflow;
const workflow_1 = require("@temporalio/workflow");
const buildSegmentsICPWorkflow_1 = require("./buildSegmentsICPWorkflow");
// Define the activity interface and options
const { logWorkflowExecutionActivity, saveCronStatusActivity, getSiteActivity, buildNewSegmentsActivity, buildICPSegmentsActivity, } = (0, workflow_1.proxyActivities)({
    startToCloseTimeout: '5 minutes', // Each activity has 5 minutes maximum execution time
    retry: {
        maximumAttempts: 3,
    },
});
/**
 * Workflow to build segments for a site
 *
 * This workflow:
 * 1. Gets site information by siteId to obtain the URL
 * 2. Builds segments using the site's URL via the segments API
 *
 * @param options - Configuration options for segment building
 */
async function buildSegmentsWorkflow(options) {
    // Support both siteId (legacy) and site_id (new)
    const siteId = options.site_id || options.siteId;
    if (!siteId) {
        throw new Error('No site ID provided');
    }
    const workflowId = `build-segments-${siteId}`;
    const startTime = Date.now();
    console.log(`🎯 Starting build segments workflow for site ${siteId}`);
    console.log(`📋 Options:`, JSON.stringify(options, null, 2));
    // Log workflow execution start
    await logWorkflowExecutionActivity({
        workflowId,
        workflowType: 'buildSegmentsWorkflow',
        status: 'STARTED',
        input: options,
    });
    // Update cron status to indicate the workflow is running
    await saveCronStatusActivity({
        siteId: siteId,
        workflowId,
        scheduleId: `build-segments-${siteId}`,
        activityName: 'buildSegmentsWorkflow',
        status: 'RUNNING',
        lastRun: new Date().toISOString()
    });
    const errors = [];
    let segments = [];
    let analysis = null;
    let segmentsBuilt = 0;
    let siteName = '';
    let siteUrl = '';
    let generalSegmentsSuccess = false;
    let icpSegmentsSuccess = false;
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
        if (!siteUrl) {
            const errorMsg = `Site ${siteId} has no URL configured`;
            console.error(`❌ ${errorMsg}`);
            errors.push(errorMsg);
            throw new Error(errorMsg);
        }
        console.log(`🎯 Step 2: Building segments for ${siteName}...`);
        // Prepare segment building request for new API
        const segmentRequest = {
            siteId: siteId,
            userId: options.userId || site.user_id,
            segmentData: {
                segmentCount: options.segmentCount || 5
            }
        };
        console.log(`🔧 Segment building configuration:`);
        console.log(`   - Site ID: ${segmentRequest.siteId}`);
        console.log(`   - User ID: ${segmentRequest.userId}`);
        console.log(`   - Segment count: ${segmentRequest.segmentData.segmentCount}`);
        // Step 1: Build segments using the new segments API
        console.log(`📊 Step 2a: Building general segments...`);
        try {
            const segmentResult = await buildNewSegmentsActivity(segmentRequest);
            // Activity now throws error on failure, so if we reach here, it succeeded
            generalSegmentsSuccess = true;
            // Extract segments from the correct location in the response
            // They might be in segments array or in analysis.data.segments
            let extractedSegments = segmentResult.segments || [];
            if (extractedSegments.length === 0 && segmentResult.analysis?.data?.segments) {
                extractedSegments = segmentResult.analysis.data.segments;
                console.log(`📋 Extracted ${extractedSegments.length} segments from analysis.data.segments`);
            }
            segments = extractedSegments;
            analysis = segmentResult.analysis;
            segmentsBuilt = segments.length;
            console.log(`✅ General segments built successfully: ${segmentsBuilt} segments`);
        }
        catch (error) {
            const errorMsg = `General segments activity failed: ${error instanceof Error ? error.message : String(error)}`;
            console.log(`❌ ${errorMsg}`);
            errors.push(errorMsg);
            generalSegmentsSuccess = false; // Asegurar que esté en false
        }
        // Step 2: Build ICP segments using the robust ICP workflow (only if general segments succeeded)
        console.log(`🎯 Step 2b: Building ICP segments using robust workflow...`);
        if (generalSegmentsSuccess && segments.length > 0) {
            try {
                // Extract segment IDs from the analysis response for the ICP workflow
                const segmentIds = analysis?.data?.segment_ids || [];
                if (segmentIds.length > 0) {
                    console.log(`📋 Using ${segmentIds.length} segment IDs for robust ICP analysis: ${segmentIds.join(', ')}`);
                    // Start ICP workflow as a child workflow for better robustness
                    const icpWorkflowHandle = await (0, workflow_1.startChild)(buildSegmentsICPWorkflow_1.buildSegmentsICPWorkflow, {
                        workflowId: `build-segments-icp-${siteId}-${Date.now()}`,
                        args: [{
                                site_id: siteId,
                                userId: options.userId || site.user_id,
                                segmentIds: segmentIds,
                                aiProvider: options.aiProvider,
                                aiModel: options.aiModel
                            }],
                    });
                    console.log(`⏳ Waiting for robust ICP workflow completion...`);
                    const icpResult = await icpWorkflowHandle.result();
                    if (icpResult.success) {
                        icpSegmentsSuccess = true;
                        const icpSegments = icpResult.segments || [];
                        console.log(`✅ ICP segments built robustly: ${icpSegments.length}`);
                        // Combine both results
                        segments = [...segments, ...icpSegments];
                        segmentsBuilt = segments.length;
                        // Merge analysis if available
                        if (icpResult.analysis) {
                            analysis = {
                                general: analysis,
                                icp: icpResult.analysis
                            };
                        }
                    }
                    else {
                        const errorMsg = `Robust ICP workflow failed: ${icpResult.errors.join('; ')}`;
                        console.log(`⚠️ ${errorMsg}`);
                        errors.push(errorMsg);
                    }
                }
                else {
                    console.log(`⚠️ No valid segment IDs found for ICP analysis`);
                    errors.push(`No valid segment IDs found for ICP analysis`);
                }
            }
            catch (error) {
                const errorMsg = `Robust ICP workflow failed: ${error instanceof Error ? error.message : String(error)}`;
                console.log(`⚠️ ${errorMsg}`);
                errors.push(errorMsg);
            }
        }
        else {
            console.log(`⏭️ Skipping ICP segments - general segments failed or returned no results`);
            errors.push(`Skipping ICP segments - general segments failed or returned no results`);
        }
        // Determine overall success: at least one API should succeed for partial success
        const overallSuccess = generalSegmentsSuccess && icpSegmentsSuccess;
        const partialSuccess = generalSegmentsSuccess || icpSegmentsSuccess;
        console.log(`🔍 Success status: generalSegmentsSuccess=${generalSegmentsSuccess}, icpSegmentsSuccess=${icpSegmentsSuccess}`);
        if (overallSuccess) {
            console.log(`✅ Successfully built segments for ${siteName} (both APIs succeeded)`);
            console.log(`📊 Results: ${segmentsBuilt} total segments created`);
        }
        else if (partialSuccess) {
            console.log(`⚠️ Partially completed segment building for ${siteName} (one API succeeded)`);
            console.log(`📊 Results: ${segmentsBuilt} segments created (one process failed)`);
        }
        else {
            console.log(`❌ Failed to build segments for ${siteName} (both APIs failed)`);
            console.log(`📊 Results: ${segmentsBuilt} segments created`);
        }
        if (segments.length > 0) {
            console.log(`🎯 Segments overview:`);
            segments.forEach((segment, index) => {
                console.log(`   ${index + 1}. ${segment.name || segment.title || `Segment ${index + 1}`}`);
            });
        }
        const executionTime = `${((Date.now() - startTime) / 1000).toFixed(2)}s`;
        const result = {
            success: partialSuccess, // Consider successful if at least one API worked
            siteId: siteId,
            siteName,
            siteUrl,
            segmentsBuilt,
            mode: 'create', // Default mode for new API
            segments,
            analysis,
            errors,
            executionTime,
            completedAt: new Date().toISOString()
        };
        if (overallSuccess) {
            console.log(`🎉 Build segments workflow completed successfully!`);
            console.log(`📊 Summary: ${segmentsBuilt} total segments built for ${siteName} in ${executionTime}`);
            // Update cron status to indicate successful completion
            await saveCronStatusActivity({
                siteId: siteId,
                workflowId,
                scheduleId: `build-segments-${siteId}`,
                activityName: 'buildSegmentsWorkflow',
                status: 'COMPLETED',
                lastRun: new Date().toISOString()
            });
        }
        else if (partialSuccess) {
            console.log(`⚠️ Build segments workflow completed with partial success!`);
            console.log(`📊 Summary: ${segmentsBuilt} segments built for ${siteName} in ${executionTime} (one API succeeded)`);
            // Update cron status to indicate partial completion
            await saveCronStatusActivity({
                siteId: siteId,
                workflowId,
                scheduleId: `build-segments-${siteId}`,
                activityName: 'buildSegmentsWorkflow',
                status: 'PARTIAL',
                lastRun: new Date().toISOString(),
                errorMessage: errors.join('; ')
            });
        }
        else {
            console.log(`❌ Build segments workflow failed completely!`);
            console.log(`📊 Summary: ${segmentsBuilt} segments built for ${siteName} in ${executionTime} (both APIs failed)`);
            // Update cron status to indicate failure
            await saveCronStatusActivity({
                siteId: siteId,
                workflowId,
                scheduleId: `build-segments-${siteId}`,
                activityName: 'buildSegmentsWorkflow',
                status: 'FAILED',
                lastRun: new Date().toISOString(),
                errorMessage: errors.join('; ')
            });
        }
        // Log completion (successful, partial, or failed)
        let logStatus;
        if (overallSuccess) {
            logStatus = 'COMPLETED';
        }
        else if (partialSuccess) {
            logStatus = 'PARTIAL';
        }
        else {
            logStatus = 'FAILED';
        }
        await logWorkflowExecutionActivity({
            workflowId,
            workflowType: 'buildSegmentsWorkflow',
            status: logStatus,
            input: options,
            output: result,
        });
        return result;
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`❌ Build segments workflow failed: ${errorMessage}`);
        const executionTime = `${((Date.now() - startTime) / 1000).toFixed(2)}s`;
        // Update cron status to indicate failure
        await saveCronStatusActivity({
            siteId: siteId,
            workflowId,
            scheduleId: `build-segments-${siteId}`,
            activityName: 'buildSegmentsWorkflow',
            status: 'FAILED',
            lastRun: new Date().toISOString(),
            errorMessage: errorMessage,
            retryCount: 1
        });
        // Log workflow execution failure
        await logWorkflowExecutionActivity({
            workflowId,
            workflowType: 'buildSegmentsWorkflow',
            status: 'FAILED',
            input: options,
            error: errorMessage,
        });
        // Return failed result instead of throwing to provide more information
        const result = {
            success: false,
            siteId: siteId,
            siteName,
            siteUrl,
            segmentsBuilt,
            mode: 'create', // Default mode for new API
            segments,
            analysis,
            errors: [...errors, errorMessage],
            executionTime,
            completedAt: new Date().toISOString()
        };
        return result;
    }
}
