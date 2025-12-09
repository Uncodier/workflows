"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchLead = fetchLead;
exports.updateLead = updateLead;
exports.fetchLeadsBySegmentsAndStatus = fetchLeadsBySegmentsAndStatus;
async function fetchLead(client, leadId) {
    console.log(`🔍 Fetching lead information for: ${leadId}`);
    const { data, error } = await client
        .from('leads')
        .select('*')
        .eq('id', leadId)
        .single();
    if (error) {
        console.error(`❌ Error fetching lead ${leadId}:`, error);
        throw new Error(`Failed to fetch lead: ${error.message}`);
    }
    if (!data) {
        throw new Error(`Lead ${leadId} not found`);
    }
    console.log(`✅ Successfully fetched lead information for ${leadId}`);
    return data;
}
async function updateLead(client, leadId, updateData) {
    console.log(`🔍 Updating lead information for: ${leadId}`);
    console.log(`📝 Update data:`, JSON.stringify(updateData, null, 2));
    const { data, error } = await client
        .from('leads')
        .update({
        ...updateData,
        updated_at: new Date().toISOString()
    })
        .eq('id', leadId)
        .select()
        .single();
    if (error) {
        console.error(`❌ Error updating lead ${leadId}:`, error);
        throw new Error(`Failed to update lead: ${error.message}`);
    }
    if (!data) {
        throw new Error(`Lead ${leadId} not found or update failed`);
    }
    console.log(`✅ Successfully updated lead information for ${leadId}`);
    return data;
}
async function fetchLeadsBySegmentsAndStatus(client, siteId, segmentIds, status, limit) {
    // Log the query parameters for debugging
    const hasSegmentFilter = segmentIds.length > 0;
    const hasStatusFilter = status.length > 0;
    console.log(`🔍 Fetching leads for site: ${siteId}`);
    console.log(`   - Segment filter: ${hasSegmentFilter ? segmentIds.join(', ') : 'None (all segments)'}`);
    console.log(`   - Status filter: ${hasStatusFilter ? status.join(', ') : 'None (all statuses)'}`);
    console.log(`   - Limit: ${limit || 500}`);
    console.log(`   - Order: Latest created first (created_at DESC)`);
    // Build query starting with basic filters
    let query = client
        .from('leads')
        .select('*')
        .eq('site_id', siteId)
        .not('email', 'is', null) // Email is not null
        .neq('email', ''); // Email is not empty string
    // Apply segment filter only if segmentIds is not empty
    if (hasSegmentFilter) {
        query = query.in('segment_id', segmentIds);
        console.log(`   ✓ Applied segment filter for ${segmentIds.length} segments`);
    }
    // Apply status filter only if status is not empty
    if (hasStatusFilter) {
        query = query.in('status', status);
        console.log(`   ✓ Applied status filter for ${status.length} statuses`);
    }
    // Always order by created_at DESC to get latest leads first
    query = query.order('created_at', { ascending: false });
    // Apply limit
    if (limit) {
        query = query.limit(limit);
    }
    const { data, error } = await query;
    if (error) {
        console.error('❌ Error fetching leads:', error);
        return { data: null, error };
    }
    const resultCount = data?.length || 0;
    console.log(`✅ Successfully fetched ${resultCount} leads from database`);
    // Log filter results for transparency
    if (!hasSegmentFilter && !hasStatusFilter) {
        console.log(`   📋 Query result: All leads with email from site (newest first)`);
    }
    else if (!hasSegmentFilter) {
        console.log(`   📋 Query result: All segments + status filter + email required (newest first)`);
    }
    else if (!hasStatusFilter) {
        console.log(`   📋 Query result: Segment filter + all statuses + email required (newest first)`);
    }
    else {
        console.log(`   📋 Query result: Segment filter + status filter + email required (newest first)`);
    }
    return { data, error: null };
}
