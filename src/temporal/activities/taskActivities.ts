import { getSupabaseService } from '../services/supabaseService';
import { apiService } from '../services/apiService';
import { fetchUpcomingTasks, Task } from '../services/supabase-impl/tasks';

export interface FetchUpcomingTasksParams {
  timeWindowHours: number;
}

export async function fetchUpcomingTasksActivity(params: FetchUpcomingTasksParams): Promise<Task[]> {
  const supabase = getSupabaseService().getClient();
  return fetchUpcomingTasks(supabase, params.timeWindowHours);
}

export interface TaskMember {
  email: string;
  name: string;
  role: 'assignee' | 'lead';
  lang?: string;
  tz?: string;
}

export async function getTaskMembersActivity(task: Task): Promise<TaskMember[]> {
  const supabase = getSupabaseService().getClient();
  const members: TaskMember[] = [];

  // Get lead
  if (task.lead_id) {
    const { data: lead, error: leadError } = await supabase.from('leads').select('email, name, language').eq('id', task.lead_id).maybeSingle();
    if (leadError) console.error(`Error fetching lead for task ${task.id}:`, leadError);
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
    if (profileError) console.error(`Error fetching profile for task ${task.id}:`, profileError);
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

export interface FormatTaskNotificationParams {
  task: Task;
  member: TaskMember;
  timeWindowHours: number;
}

export async function translateAndFormatTaskNotificationActivity(params: FormatTaskNotificationParams): Promise<{ subject: string, message: string }> {
  const { task, member, timeWindowHours } = params;

  let parsedNotes = task.description || '';
  
  const isAssignee = member.role === 'assignee';
  
  const subject = timeWindowHours === 24 
    ? (isAssignee ? `Recordatorio: Tarea asignada para mañana - ${task.title}` : 'Recordatorio: Tarea programada para mañana')
    : (isAssignee ? `Recordatorio: Tarea asignada en 1 hora - ${task.title}` : 'Recordatorio: Tarea programada en 1 hora');

  const tz = member.tz || 'UTC';
  const lang = member.lang || 'es-MX';
  
  const dateOptions: Intl.DateTimeFormatOptions = { 
    timeZone: tz, 
    weekday: 'long', 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  };
  const timeOptions: Intl.DateTimeFormatOptions = { 
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
      } else {
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

export interface SendTaskNotificationParams {
  email: string;
  subject: string;
  message: string;
  site_id: string;
  lang?: string;
}

export async function sendTaskNotificationActivity(params: SendTaskNotificationParams): Promise<void> {
  console.log(`📤 Sending task notification via API`);
  
  const locale = (params.lang || 'es').startsWith('es') ? 'es' : 'en';

  const response = await apiService.post('/api/notifications/taskReminder', {
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

export interface CreateTaskCommentParams {
  task_id: string;
  content: string;
  user_id?: string;
  is_private?: boolean;
}

export async function createTaskCommentActivity(params: CreateTaskCommentParams): Promise<void> {
  const supabase = getSupabaseService().getClient();
  
  console.log(`📝 Creating timeline comment for task ${params.task_id}`);
  
  const commentData: any = {
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

