import { SupabaseClient } from '@supabase/supabase-js';

export interface Task {
  id: string;
  site_id: string;
  lead_id?: string;
  title: string;
  description?: string;
  type: string;
  status: string;
  stage: string;
  scheduled_date: string;
  assignee?: string; // This links to user profile
  notes?: string;
  metadata?: any;
}

export async function fetchUpcomingTasks(
  client: SupabaseClient,
  timeWindowHours: number = 24
): Promise<Task[]> {
  console.log(`🔍 Fetching tasks for window ~${timeWindowHours}h...`);
  
  const now = new Date();
  
  const targetTimeStart = new Date(now.getTime() + (timeWindowHours - 0.5) * 60 * 60 * 1000);
  const targetTimeEnd = new Date(now.getTime() + (timeWindowHours + 0.5) * 60 * 60 * 1000);

  const { data, error } = await client
    .from('tasks')
    .select('*')
    .in('status', ['pending', 'in_progress']) // Only active tasks
    .gte('scheduled_date', targetTimeStart.toISOString())
    .lte('scheduled_date', targetTimeEnd.toISOString());

  if (error) {
    console.error('❌ Error fetching upcoming tasks:', error);
    throw new Error(`Failed to fetch upcoming tasks: ${error.message}`);
  }

  console.log(`✅ Successfully fetched ${data?.length || 0} upcoming tasks for ${timeWindowHours}h window`);
  return data || [];
}
