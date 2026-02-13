"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.getQualificationLeadsActivity = getQualificationLeadsActivity;
const supabaseService_1 = require("../services/supabaseService");
const STAGE_ORDER = ['reminder', 'provide_value', 'breakup'];
/**
 * Derives a flat leads array from leadsByStage for backward compatibility.
 * Callers expecting only `leads` receive the correct structure regardless of workflow early-exit.
 */
function buildLeadsFromStages(leadsByStage, limit) {
    const combined = STAGE_ORDER.flatMap((stage) => leadsByStage[stage] ?? []);
    return combined.slice(0, limit);
}
/**
 * Fetch leads for follow-up sequence stages:
 * 1. Reminder (Day N): daysWithoutReply since last assistant message
 * 2. Value (Day 7): 4-6 days since last "reminder" message
 * 3. Break-up (Day 14): 7+ days since last "provide_value" message
 *
 * Also handles resumption: if last assistant message > max(7, daysWithoutReply) days and no stage metadata,
 * it's treated as "reminder" (resumed) to start the sequence.
 */
async function getQualificationLeadsActivity(params) {
    const siteId = params.site_id;
    const daysWithoutReply = typeof params.daysWithoutReply === 'number' ? params.daysWithoutReply : 7;
    const maxPerStage = typeof params.maxLeadsPerStage === 'number' ? params.maxLeadsPerStage : 10;
    const legacyLimit = typeof params.limit === 'number' ? params.limit : 30;
    // Use the provided daysWithoutReply for the threshold
    const threshold = new Date(Date.now() - daysWithoutReply * 24 * 60 * 60 * 1000);
    const thresholdIso = threshold.toISOString();
    const errors = [];
    const leadsByStage = {
        reminder: [],
        provide_value: [],
        breakup: []
    };
    const stats = {
        reminder: 0,
        provide_value: 0,
        breakup: 0,
        resumed: 0
    };
    try {
        const supabaseService = (0, supabaseService_1.getSupabaseService)();
        const isConnected = await supabaseService.getConnectionStatus();
        if (!isConnected) {
            const emptyByStage = { reminder: [], provide_value: [], breakup: [] };
            return {
                success: false,
                leads: buildLeadsFromStages(emptyByStage, legacyLimit),
                leadsByStage: emptyByStage,
                totalChecked: 0,
                considered: 0,
                excludedByAssignee: 0,
                thresholdDate: thresholdIso,
                errors: ['Database not available']
            };
        }
        // Use service-role client for server-side filtering
        const { supabaseServiceRole } = await Promise.resolve().then(() => __importStar(require('../../lib/supabase/client')));
        // Step 1: Fetch candidate leads for this site
        const { data: candidateLeads, error: leadsError } = await supabaseServiceRole
            .from('leads')
            .select('id, name, email, phone, status, site_id, assignee_id')
            .eq('site_id', siteId)
            .in('status', ['contacted', 'qualified'])
            .order('updated_at', { ascending: false })
            .limit(500);
        if (leadsError) {
            const emptyByStage = { reminder: [], provide_value: [], breakup: [] };
            return {
                success: false,
                leads: buildLeadsFromStages(emptyByStage, legacyLimit),
                leadsByStage: emptyByStage,
                totalChecked: 0,
                considered: 0,
                excludedByAssignee: 0,
                thresholdDate: thresholdIso,
                errors: [leadsError.message]
            };
        }
        let totalChecked = 0;
        let excludedByAssignee = 0;
        for (const lead of candidateLeads || []) {
            totalChecked++;
            if (lead.assignee_id) {
                excludedByAssignee++;
                continue;
            }
            // Fetch message history for this lead to determine stage
            const { data: messages, error: msgError } = await supabaseServiceRole
                .from('messages')
                .select('id, created_at, role, custom_data, conversations!inner(site_id)')
                .eq('lead_id', lead.id)
                .eq('conversations.site_id', siteId)
                .order('created_at', { ascending: false })
                .limit(1);
            if (msgError) {
                errors.push(`Failed to fetch messages for lead ${lead.id}: ${msgError.message}`);
                continue;
            }
            if (!messages || messages.length === 0)
                continue;
            const lastMsg = messages[0];
            // If last message is from user, sequence resets/waits
            if (lastMsg.role === 'user') {
                continue;
            }
            const lastMsgDate = new Date(lastMsg.created_at);
            const daysSinceLastMsg = (Date.now() - lastMsgDate.getTime()) / (1000 * 60 * 60 * 24);
            const customData = lastMsg.custom_data || {};
            const currentStage = customData.sequence_stage;
            let assignedStage = null;
            let reason = '';
            // Stage Detection Logic
            if (!currentStage) {
                // Resumption or Initial Reminder
                if (daysSinceLastMsg > Math.max(7, daysWithoutReply)) {
                    assignedStage = 'reminder';
                    reason = 'resumed_from_legacy_flow';
                }
                else if (daysSinceLastMsg >= daysWithoutReply) {
                    assignedStage = 'reminder';
                    reason = `initial_reminder_${daysWithoutReply}_days`;
                }
            }
            else if (currentStage === 'reminder') {
                if (daysSinceLastMsg >= 4) {
                    assignedStage = 'provide_value';
                    reason = 'value_stage_4_days_after_reminder';
                }
            }
            else if (currentStage === 'provide_value') {
                if (daysSinceLastMsg >= 7) {
                    assignedStage = 'breakup';
                    reason = 'breakup_stage_7_days_after_value';
                }
            }
            else if (currentStage === 'breakup') {
                // If they reached the breakup stage and haven't replied in 7 days
                if (daysSinceLastMsg >= 7) {
                    if (lead.status === 'contacted') {
                        const { error: updateError } = await supabaseServiceRole
                            .from('leads')
                            .update({ status: 'cold' })
                            .eq('id', lead.id);
                        if (updateError) {
                            errors.push(`Failed to mark lead ${lead.id} as cold: ${updateError.message}`);
                        }
                        else {
                            console.log(`❄️ Lead ${lead.id} marked as 'cold' after breakup stage timeout`);
                        }
                    }
                    else {
                        // For other statuses (like 'qualified'), mark the sequence as completed in message metadata
                        // to avoid them being orphaned/processed repeatedly in this loop.
                        const { error: updateMsgError } = await supabaseServiceRole
                            .from('messages')
                            .update({
                            custom_data: {
                                ...customData,
                                sequence_stage: 'completed'
                            }
                        })
                            .eq('id', lastMsg.id);
                        if (updateMsgError) {
                            errors.push(`Failed to mark sequence as completed for lead ${lead.id}: ${updateMsgError.message}`);
                        }
                        else {
                            console.log(`🏁 Sequence marked as 'completed' for lead ${lead.id} (status: ${lead.status})`);
                        }
                    }
                }
            }
            if (assignedStage && leadsByStage[assignedStage].length < maxPerStage) {
                leadsByStage[assignedStage].push({
                    ...lead,
                    sequence_stage: assignedStage,
                    sequence_reason: reason
                });
                // Use mutually exclusive stats to ensure the sum equals the total leads
                if (reason === 'resumed_from_legacy_flow') {
                    stats.resumed++;
                }
                else {
                    stats[assignedStage]++;
                }
            }
        }
        const combinedLeads = buildLeadsFromStages(leadsByStage, legacyLimit);
        console.log(`📊 Qualification summary: ${combinedLeads.length} leads across stages:`, stats);
        return {
            success: true,
            leads: combinedLeads,
            leadsByStage,
            totalChecked,
            considered: candidateLeads?.length || 0,
            excludedByAssignee,
            thresholdDate: thresholdIso,
            stats,
            errors: errors.length ? errors : undefined
        };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const emptyByStage = { reminder: [], provide_value: [], breakup: [] };
        return {
            success: false,
            leads: buildLeadsFromStages(emptyByStage, legacyLimit),
            leadsByStage: emptyByStage,
            totalChecked: 0,
            considered: 0,
            excludedByAssignee: 0,
            thresholdDate: thresholdIso,
            errors: [message]
        };
    }
}
