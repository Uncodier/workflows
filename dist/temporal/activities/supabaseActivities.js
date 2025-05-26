"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logWorkflowExecutionActivity = logWorkflowExecutionActivity;
exports.trackApiCallActivity = trackApiCallActivity;
exports.fetchConfigurationActivity = fetchConfigurationActivity;
exports.storeWorkflowResultActivity = storeWorkflowResultActivity;
exports.createResourceActivity = createResourceActivity;
exports.updateResourceActivity = updateResourceActivity;
exports.deleteResourceActivity = deleteResourceActivity;
const supabase_js_1 = require("@supabase/supabase-js");
const config_1 = require("../../config/config");
const supabase = (0, supabase_js_1.createClient)(config_1.supabaseConfig.url, config_1.supabaseConfig.key);
/**
 * Activity to log workflow execution to Supabase
 */
async function logWorkflowExecutionActivity(data) {
    const { data: result, error } = await supabase
        .from('workflow_executions')
        .insert(data);
    if (error) {
        console.error('Error logging workflow execution:', error);
        throw error;
    }
    return result;
}
/**
 * Activity to track API call metrics in Supabase
 */
async function trackApiCallActivity(data) {
    const { data: result, error } = await supabase
        .from('api_call_metrics')
        .insert(data);
    if (error) {
        console.error('Error tracking API call:', error);
        throw error;
    }
    return result;
}
/**
 * Activity to fetch configuration from Supabase
 */
async function fetchConfigurationActivity(configName) {
    const { data, error } = await supabase
        .from('configurations')
        .select('*')
        .eq('name', configName)
        .single();
    if (error) {
        console.error(`Error fetching configuration ${configName}:`, error);
        throw error;
    }
    return data?.value;
}
/**
 * Activity to store workflow results in Supabase
 */
async function storeWorkflowResultActivity(data) {
    const { data: result, error } = await supabase
        .from('workflow_results')
        .insert(data);
    if (error) {
        console.error('Error storing workflow result:', error);
        throw error;
    }
    return result;
}
async function createResourceActivity(data) {
    const { data: result, error } = await supabase
        .from('resources')
        .insert(data)
        .select()
        .single();
    if (error)
        throw error;
    return result;
}
async function updateResourceActivity(id, data) {
    const { data: result, error } = await supabase
        .from('resources')
        .update(data)
        .eq('id', id)
        .select()
        .single();
    if (error)
        throw error;
    return result;
}
async function deleteResourceActivity(id) {
    const { error } = await supabase
        .from('resources')
        .delete()
        .eq('id', id);
    if (error)
        throw error;
}
