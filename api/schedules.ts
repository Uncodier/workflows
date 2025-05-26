import type { NextApiRequest, NextApiResponse } from 'next';
import { 
  createSchedule, 
  listSchedules, 
  deleteSchedule, 
  defaultSchedules,
  type ScheduleSpec 
} from '../src/temporal/schedules';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    switch (req.method) {
      case 'GET':
        const schedules = await listSchedules();
        return res.status(200).json(schedules);

      case 'POST':
        const scheduleSpec = req.body as ScheduleSpec;
        const result = await createSchedule(scheduleSpec);
        return res.status(200).json(result);

      case 'DELETE':
        const { scheduleId } = req.query;
        if (!scheduleId || typeof scheduleId !== 'string') {
          return res.status(400).json({ error: 'Schedule ID is required' });
        }
        const deleteResult = await deleteSchedule(scheduleId);
        return res.status(200).json(deleteResult);

      case 'PUT':
        // Initialize default schedules
        const results = await Promise.all(
          defaultSchedules.map(async (schedule) => {
            try {
              return await createSchedule(schedule);
            } catch (error) {
              return {
                error: `Failed to create schedule ${schedule.id}: ${error}`,
                schedule
              };
            }
          })
        );
        return res.status(200).json(results);

      default:
        res.setHeader('Allow', ['GET', 'POST', 'DELETE', 'PUT']);
        return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
    }
  } catch (error) {
    console.error('Schedule operation failed:', error);
    return res.status(500).json({ error: 'Schedule operation failed' });
  }
} 