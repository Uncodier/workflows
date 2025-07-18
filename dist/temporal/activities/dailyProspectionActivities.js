"use strict";
/**
 * Daily Prospection Activities
 * Activities for managing daily prospection workflow
 */
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
exports.getProspectionLeadsActivity = getProspectionLeadsActivity;
exports.createAwarenessTaskActivity = createAwarenessTaskActivity;
exports.updateLeadProspectionStatusActivity = updateLeadProspectionStatusActivity;
const supabaseService_1 = require("../services/supabaseService");
const logger_1 = require("../../lib/logger");
/**
 * Activity to get leads for daily prospection
 * Finds leads with:
 * - More than X hours old (default 48)
 * - Status = 'new'
 * - No tasks in 'awareness' stage
 */
async function getProspectionLeadsActivity(options) {
    const { site_id, hoursThreshold = 48 } = options;
    console.log(`🔍 Getting prospection leads for site: ${site_id}`);
    console.log(`   - Hours threshold: ${hoursThreshold} hours`);
    try {
        const supabaseService = (0, supabaseService_1.getSupabaseService)();
        console.log('🔍 Checking database connection...');
        const isConnected = await supabaseService.getConnectionStatus();
        if (!isConnected) {
            console.log('⚠️ Database not available, cannot fetch prospection leads');
            return {
                success: false,
                leads: [],
                total: 0,
                error: 'Database not available'
            };
        }
        console.log('✅ Database connection confirmed, fetching prospection leads...');
        // Import supabase service role client (bypasses RLS)
        const { supabaseServiceRole } = await Promise.resolve().then(() => __importStar(require('../../lib/supabase/client')));
        // Calculate the threshold date (48 hours ago by default)
        const thresholdDate = new Date();
        thresholdDate.setHours(thresholdDate.getHours() - hoursThreshold);
        const createdBefore = thresholdDate.toISOString();
        console.log(`📅 Looking for leads created before: ${createdBefore}`);
        // First, get all leads with status 'new' and older than threshold
        const { data: candidateLeads, error: leadsError } = await supabaseServiceRole
            .from('leads')
            .select('*')
            .eq('site_id', site_id)
            .eq('status', 'new')
            .lt('created_at', createdBefore)
            .order('created_at', { ascending: true }); // Oldest first for prospection
        if (leadsError) {
            logger_1.logger.error('❌ Error fetching candidate leads', {
                error: leadsError.message,
                site_id,
                hoursThreshold
            });
            return {
                success: false,
                leads: [],
                total: 0,
                error: leadsError.message
            };
        }
        console.log(`📋 Found ${candidateLeads?.length || 0} candidate leads with status 'new' older than ${hoursThreshold} hours`);
        if (!candidateLeads || candidateLeads.length === 0) {
            console.log('✅ No candidate leads found for prospection');
            return {
                success: true,
                leads: [],
                total: 0,
                criteria: {
                    site_id,
                    status: 'new',
                    hoursThreshold,
                    createdBefore
                }
            };
        }
        // Get lead IDs for task filtering
        const leadIds = candidateLeads.map(lead => lead.id);
        // Now check which of these leads have tasks in 'awareness' stage
        const { data: awarenessTasksData, error: tasksError } = await supabaseServiceRole
            .from('tasks')
            .select('lead_id, id, status, stage')
            .eq('site_id', site_id)
            .eq('stage', 'awareness')
            .in('lead_id', leadIds);
        if (tasksError) {
            logger_1.logger.error('❌ Error checking awareness tasks', {
                error: tasksError.message,
                site_id,
                leadIds: leadIds.length
            });
            return {
                success: false,
                leads: [],
                total: 0,
                error: tasksError.message
            };
        }
        console.log(`📋 Found ${awarenessTasksData?.length || 0} existing awareness tasks for candidate leads`);
        // Create a set of lead IDs that already have awareness tasks
        const leadsWithAwarenessTasks = new Set((awarenessTasksData || []).map(task => task.lead_id));
        // Filter out leads that already have awareness tasks
        const prospectionLeads = candidateLeads.filter(lead => !leadsWithAwarenessTasks.has(lead.id));
        console.log(`✅ Successfully identified ${prospectionLeads.length} leads for prospection`);
        console.log(`   - Total candidates: ${candidateLeads.length}`);
        console.log(`   - With awareness tasks: ${leadsWithAwarenessTasks.size}`);
        console.log(`   - Available for prospection: ${prospectionLeads.length}`);
        if (prospectionLeads.length > 0) {
            console.log(`📋 Prospection leads summary:`);
            prospectionLeads.forEach((lead, index) => {
                const daysOld = Math.floor((new Date().getTime() - new Date(lead.created_at).getTime()) / (1000 * 60 * 60 * 24));
                console.log(`   ${index + 1}. ${lead.name || lead.email} (${daysOld} days old)`);
            });
        }
        return {
            success: true,
            leads: prospectionLeads,
            total: prospectionLeads.length,
            criteria: {
                site_id,
                status: 'new',
                hoursThreshold,
                createdBefore
            }
        };
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger_1.logger.error('❌ Exception getting prospection leads', {
            error: errorMessage,
            site_id,
            hoursThreshold
        });
        return {
            success: false,
            leads: [],
            total: 0,
            error: errorMessage
        };
    }
}
/**
 * Activity to create an awareness task for a lead
 */
async function createAwarenessTaskActivity(options) {
    const { lead_id, site_id, userId } = options;
    console.log(`📝 Creating awareness task for lead: ${lead_id}`);
    try {
        const supabaseService = (0, supabaseService_1.getSupabaseService)();
        console.log('🔍 Checking database connection...');
        const isConnected = await supabaseService.getConnectionStatus();
        if (!isConnected) {
            console.log('⚠️ Database not available, cannot create awareness task');
            return {
                success: false,
                error: 'Database not available'
            };
        }
        console.log('✅ Database connection confirmed, creating awareness task...');
        // Import supabase service role client (bypasses RLS)
        const { supabaseServiceRole } = await Promise.resolve().then(() => __importStar(require('../../lib/supabase/client')));
        // Check if lead exists
        const { data: lead, error: leadError } = await supabaseServiceRole
            .from('leads')
            .select('id, name, email, site_id')
            .eq('id', lead_id)
            .eq('site_id', site_id)
            .single();
        if (leadError || !lead) {
            const errorMsg = `Lead ${lead_id} not found or doesn't belong to site ${site_id}`;
            logger_1.logger.error('❌ Lead not found for awareness task creation', {
                lead_id,
                site_id,
                error: leadError?.message
            });
            return {
                success: false,
                error: errorMsg
            };
        }
        // Check if awareness task already exists
        const { data: existingTasks, error: checkError } = await supabaseServiceRole
            .from('tasks')
            .select('id, status, stage')
            .eq('lead_id', lead_id)
            .eq('site_id', site_id)
            .eq('stage', 'awareness');
        if (checkError) {
            logger_1.logger.error('❌ Error checking existing awareness tasks', {
                error: checkError.message,
                lead_id,
                site_id
            });
            return {
                success: false,
                error: checkError.message
            };
        }
        if (existingTasks && existingTasks.length > 0) {
            const existingTask = existingTasks[0];
            console.log(`⚠️ Awareness task already exists for lead ${lead_id}: ${existingTask.id} (${existingTask.status})`);
            return {
                success: true,
                task: existingTask,
                taskId: existingTask.id
            };
        }
        // Prepare task data
        const scheduledDate = options.scheduled_date || new Date().toISOString();
        const title = options.title || `Inicial awareness para ${lead.name || lead.email}`;
        const description = options.description || `Tarea de prospección inicial para establecer primer contacto con el lead ${lead.name || lead.email}`;
        const taskData = {
            lead_id: lead_id,
            title: title,
            description: description,
            type: 'prospection',
            stage: 'awareness',
            status: 'pending',
            scheduled_date: scheduledDate,
            assignee: userId || null,
            site_id: site_id,
            user_id: userId || null,
            priority: 1, // High priority for new prospection
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };
        // Create the awareness task
        const { data: task, error: createError } = await supabaseServiceRole
            .from('tasks')
            .insert([taskData])
            .select()
            .single();
        if (createError) {
            logger_1.logger.error('❌ Failed to create awareness task', {
                error: createError.message,
                lead_id,
                site_id
            });
            return {
                success: false,
                error: createError.message
            };
        }
        logger_1.logger.info('✅ Awareness task created successfully', {
            taskId: task.id,
            leadId: lead_id,
            siteId: site_id,
            title: task.title
        });
        console.log(`✅ Successfully created awareness task ${task.id} for lead ${lead.name || lead.email}`);
        return {
            success: true,
            task: task,
            taskId: task.id
        };
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger_1.logger.error('❌ Exception creating awareness task', {
            error: errorMessage,
            lead_id,
            site_id
        });
        return {
            success: false,
            error: errorMessage
        };
    }
}
/**
 * Activity to update lead status after prospection task creation
 */
async function updateLeadProspectionStatusActivity(options) {
    const { lead_id, site_id, newStatus = 'contacted', notes } = options;
    console.log(`📝 Updating lead prospection status for: ${lead_id} to '${newStatus}'`);
    try {
        const supabaseService = (0, supabaseService_1.getSupabaseService)();
        const isConnected = await supabaseService.getConnectionStatus();
        if (!isConnected) {
            return {
                success: false,
                error: 'Database not available'
            };
        }
        // Import supabase service role client (bypasses RLS)
        const { supabaseServiceRole } = await Promise.resolve().then(() => __importStar(require('../../lib/supabase/client')));
        const updateData = {
            status: newStatus,
            updated_at: new Date().toISOString(),
            last_contact: new Date().toISOString()
        };
        if (notes) {
            updateData.notes = notes;
        }
        const { error } = await supabaseServiceRole
            .from('leads')
            .update(updateData)
            .eq('id', lead_id)
            .eq('site_id', site_id)
            .select()
            .single();
        if (error) {
            logger_1.logger.error('❌ Failed to update lead prospection status', {
                error: error.message,
                lead_id,
                site_id,
                newStatus
            });
            return {
                success: false,
                error: error.message
            };
        }
        console.log(`✅ Successfully updated lead ${lead_id} status to '${newStatus}'`);
        return {
            success: true
        };
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger_1.logger.error('❌ Exception updating lead prospection status', {
            error: errorMessage,
            lead_id,
            site_id
        });
        return {
            success: false,
            error: errorMessage
        };
    }
}
