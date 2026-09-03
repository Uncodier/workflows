"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchUpcomingTasksActivity = fetchUpcomingTasksActivity;
exports.getTaskMembersActivity = getTaskMembersActivity;
exports.translateAndFormatTaskNotificationActivity = translateAndFormatTaskNotificationActivity;
exports.sendTaskNotificationActivity = sendTaskNotificationActivity;
exports.createTaskCommentActivity = createTaskCommentActivity;
exports.markTaskReminderSentActivity = markTaskReminderSentActivity;
const supabaseService_1 = require("../services/supabaseService");
const apiService_1 = require("../services/apiService");
const tasks_1 = require("../services/supabase-impl/tasks");
async function fetchUpcomingTasksActivity(params) {
    const supabase = (0, supabaseService_1.getSupabaseService)().getClient();
    return (0, tasks_1.fetchUpcomingTasks)(supabase, params.timeWindowHours);
}
async function getTaskMembersActivity(task) {
    const supabase = (0, supabaseService_1.getSupabaseService)().getClient();
    const members = [];
    // Get lead
    if (task.lead_id) {
        const { data: lead, error: leadError } = await supabase.from('leads').select('email, name, language').eq('id', task.lead_id).maybeSingle();
        if (leadError)
            console.error(`Error fetching lead for task ${task.id}:`, leadError);
        if (lead?.email) {
            members.push({
                email: lead.email,
                name: lead.name || 'Customer',
                role: 'lead',
                lang: lead.language
            });
        }
    }
    // Get assignee
    if (task.assignee) {
        const { data: profile, error: profileError } = await supabase.from('profiles').select('email, name, language, timezone').eq('id', task.assignee).maybeSingle();
        if (profileError)
            console.error(`Error fetching profile for task ${task.id}:`, profileError);
        if (profile?.email) {
            members.push({
                email: profile.email,
                name: profile.name || 'Team Member',
                role: 'assignee',
                lang: profile.language,
                tz: profile.timezone
            });
        }
    }
    return members;
}
async function translateAndFormatTaskNotificationActivity(params) {
    const { task, member, timeWindowHours } = params;
    let parsedNotes = task.description || '';
    const isAssignee = member.role === 'assignee';
    const subject = timeWindowHours === 24
        ? (isAssignee ? `Recordatorio: Tarea asignada para mañana - ${task.title}` : 'Recordatorio: Tarea programada para mañana')
        : (isAssignee ? `Recordatorio: Tarea asignada en 1 hora - ${task.title}` : 'Recordatorio: Tarea programada en 1 hora');
    const tz = member.tz || 'UTC';
    const lang = member.lang || 'es-MX';
    const dateOptions = {
        timeZone: tz,
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    };
    const timeOptions = {
        timeZone: tz,
        hour: '2-digit',
        minute: '2-digit'
    };
    const scheduledDate = new Date(task.scheduled_date);
    const dateString = scheduledDate.toLocaleDateString(lang, dateOptions);
    const timeString = scheduledDate.toLocaleTimeString(lang, timeOptions);
    let locationStr = '';
    let ctaLink = '';
    if (task.metadata && task.metadata._calendar_context?.location) {
        const loc = task.metadata._calendar_context.location;
        if (typeof loc === 'string') {
            if (loc.startsWith('http')) {
                locationStr = 'Reunión en línea (Videollamada)';
                ctaLink = `\n\n[Ir a la Videollamada / Reunión](${loc})`;
            }
            else {
                locationStr = loc;
            }
        }
    }
    let detailsList = `- **Título:** ${task.title}
- **Fecha:** ${dateString}
- **Hora:** ${timeString} (Zona Horaria: ${tz})
- **Tipo:** ${task.type}
- **Estatus:** ${task.status}`;
    if (locationStr) {
        detailsList += `\n- **Ubicación:** ${locationStr}`;
    }
    if (parsedNotes) {
        detailsList += `\n- **Descripción / Notas:**\n${parsedNotes}`;
    }
    const message = `
# Recordatorio de Tarea

Hola ${member.name},

Este es un recordatorio de que tienes una tarea programada próximamente.

**Detalles de la Tarea:**
${detailsList}
${ctaLink}

Por favor, ponte en contacto si necesitas realizar algún cambio o actualización.

¡Gracias!
  `.trim();
    return { subject, message };
}
async function sendTaskNotificationActivity(params) {
    console.log(`📤 Sending task notification via API`);
    const locale = (params.lang || 'es').startsWith('es') ? 'es' : 'en';
    const response = await apiService_1.apiService.post('/api/notifications/taskReminder', {
        email: params.email,
        subject: params.subject,
        message: params.message,
        site_id: params.site_id,
        locale: locale
    });
    if (!response.success) {
        throw new Error(`Failed to send task notification: ${response.error?.message}`);
    }
}
async function createTaskCommentActivity(params) {
    const supabase = (0, supabaseService_1.getSupabaseService)().getClient();
    console.log(`📝 Creating timeline comment for task ${params.task_id}`);
    const commentData = {
        task_id: params.task_id,
        content: params.content,
        is_private: params.is_private ?? false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
    };
    if (params.user_id) {
        commentData.user_id = params.user_id;
    }
    const { error } = await supabase.from('task_comments').insert([commentData]);
    if (error) {
        console.error(`❌ Failed to create task comment:`, error);
        throw new Error(`Failed to create task comment: ${error.message}`);
    }
}
async function markTaskReminderSentActivity(params) {
    const supabase = (0, supabaseService_1.getSupabaseService)().getClient();
    const { data: task, error: fetchError } = await supabase
        .from('tasks')
        .select('metadata')
        .eq('id', params.task_id)
        .single();
    if (fetchError) {
        console.error(`❌ Failed to fetch task metadata for task ${params.task_id}:`, fetchError);
        throw new Error(`Failed to fetch task metadata: ${fetchError.message}`);
    }
    const metadata = task?.metadata || {};
    const flagKey = `_reminder_${params.timeWindowHours}h_sent`;
    metadata[flagKey] = true;
    const { error: updateError } = await supabase
        .from('tasks')
        .update({ metadata })
        .eq('id', params.task_id);
    if (updateError) {
        console.error(`❌ Failed to update task metadata for task ${params.task_id}:`, updateError);
        throw new Error(`Failed to update task metadata: ${updateError.message}`);
    }
    console.log(`✅ Marked ${params.timeWindowHours}h reminder as sent for task ${params.task_id}`);
}
