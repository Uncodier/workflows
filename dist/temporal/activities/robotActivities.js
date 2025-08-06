"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startRobotStreamActivity = startRobotStreamActivity;
exports.stopRobotStreamActivity = stopRobotStreamActivity;
exports.callRobotInstanceActivity = callRobotInstanceActivity;
exports.callRobotPlanActivity = callRobotPlanActivity;
const apiService_1 = require("../services/apiService");
/**
 * Activity to start the robot stream display
 */
async function startRobotStreamActivity(params) {
    const { site_id, activity, user_id } = params;
    console.log(`📺 Starting robot stream for site: ${site_id}, activity: ${activity}${user_id ? `, user: ${user_id}` : ''}`);
    try {
        // Build request payload, only include user_id if provided
        const payload = {
            site_id,
            activity
        };
        if (user_id) {
            payload.user_id = user_id;
        }
        const response = await apiService_1.apiService.post('/api/robots/stream/start', payload);
        if (!response.success) {
            throw new Error(`Robot operation API call failed: ${response.error?.message || 'Unknown error'}`);
        }
        console.log('✅ Robot stream started successfully');
        return {
            success: true,
            data: response.data
        };
    }
    catch (error) {
        console.error('❌ Robot operation failed:', error);
        throw new Error(`Robot operation activity failed: ${error instanceof Error ? error.message : String(error)}`);
    }
}
/**
 * Activity to stop the robot stream display
 */
async function stopRobotStreamActivity(params) {
    const { site_id, activity, instance_id, user_id } = params;
    console.log(`📺 Stopping robot stream for site: ${site_id}, activity: ${activity}${instance_id ? `, instance: ${instance_id}` : ''}${user_id ? `, user: ${user_id}` : ''}`);
    try {
        // Build request payload, include available data
        const payload = {
            site_id,
            activity
        };
        if (instance_id) {
            payload.instance_id = instance_id;
        }
        if (user_id) {
            payload.user_id = user_id;
        }
        const response = await apiService_1.apiService.post('/api/robots/stream/stop', payload);
        if (!response.success) {
            throw new Error(`Robot operation API call failed: ${response.error?.message || 'Unknown error'}`);
        }
        console.log('✅ Robot stream stopped successfully');
        return {
            success: true,
            data: response.data
        };
    }
    catch (error) {
        console.error('❌ Robot operation failed:', error);
        throw new Error(`Robot operation activity failed: ${error instanceof Error ? error.message : String(error)}`);
    }
}
/**
 * Activity to call the robot instance API
 */
async function callRobotInstanceActivity(params) {
    const { site_id, activity, user_id } = params;
    console.log(`🤖 Calling robot instance API for site: ${site_id}, activity: ${activity}${user_id ? `, user: ${user_id}` : ''}`);
    try {
        // Build request payload, only include user_id if provided
        const payload = {
            site_id,
            activity
        };
        if (user_id) {
            payload.user_id = user_id;
        }
        const response = await apiService_1.apiService.post('/api/robots/instance', payload);
        if (!response.success) {
            throw new Error(`Robot operation API call failed: ${response.error?.message || 'Unknown error'}`);
        }
        console.log('✅ Robot instance API call successful');
        // Extract instance_id from response
        const instance_id = response.data?.instance_id;
        if (!instance_id) {
            console.warn('⚠️ No instance_id returned from robot/instance API');
        }
        return {
            success: true,
            instance_id,
            data: response.data
        };
    }
    catch (error) {
        console.error('❌ Robot operation failed:', error);
        throw new Error(`Robot operation activity failed: ${error instanceof Error ? error.message : String(error)}`);
    }
}
/**
 * Activity to call the robot plan API
 */
async function callRobotPlanActivity(params) {
    const { site_id, activity, instance_id, user_id } = params;
    console.log(`🤖 Calling robot plan API for site: ${site_id}, activity: ${activity}, instance: ${instance_id}${user_id ? `, user: ${user_id}` : ''}`);
    try {
        // Build request payload, always include instance_id, optionally include user_id
        const payload = {
            site_id,
            activity,
            instance_id
        };
        if (user_id) {
            payload.user_id = user_id;
        }
        const response = await apiService_1.apiService.post('/api/agents/growth/robot/plan', payload);
        if (!response.success) {
            throw new Error(`Robot operation API call failed: ${response.error?.message || 'Unknown error'}`);
        }
        console.log('✅ Robot plan API call successful');
        return {
            success: true,
            data: response.data
        };
    }
    catch (error) {
        console.error('❌ Robot operation failed:', error);
        throw new Error(`Robot operation activity failed: ${error instanceof Error ? error.message : String(error)}`);
    }
}
